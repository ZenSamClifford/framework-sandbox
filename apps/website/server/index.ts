import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";

import { resolveIdentity } from "routing";

import { collectPanelData, injectPanel } from "./panel.ts";

// Resolved from this file, not from the working directory: the container runs
// `node server/index.ts` from /app, but local verification runs it from the repo root.
const distDir = resolve(import.meta.dirname, "../dist");

// The block declares /static as its static path, and the Request Handler forwards
// only declared static paths. Everything the build emits is reachable under it,
// because vite.config.ts sets `base: "/static/"` and this mount puts the files there.
const STATIC_PREFIX = "/static/";

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const contentTypeFor = (path: string) =>
  MIME_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";

const port = Number(process.env.PORT ?? 3001);

// In the image, dist is immutable for the life of the container, so the shell is read
// once and kept. Outside it, `vp build` is expected to show up on the next refresh
// without restarting the server, so it is re-read every time. This repo's own knowledge
// base has block saturation as a live failure mode, which is why the deployed side does
// not pay a disk read per request.
const cacheShell = process.env.NODE_ENV === "production";
let cachedShell: string | undefined;

async function readShell(): Promise<string> {
  if (cacheShell && cachedShell !== undefined) return cachedShell;
  const shell = await readFile(join(distDir, "index.html"), "utf8");
  if (cacheShell) cachedShell = shell;
  return shell;
}

/**
 * Resolve a request path to a file inside dist, or null if it escapes.
 *
 * The handler strips the /_{hash}_{blockVersionId}/ prefix before the request
 * reaches the block, so what arrives here is the plain /static/... path.
 */
function resolveStaticFile(pathname: string): string | null {
  let decoded: string;
  try {
    // Throws URIError on a malformed escape, e.g. GET /static/%. Anything that
    // reaches the network is attacker-controlled, so this cannot be left to reject.
    decoded = decodeURIComponent(pathname.slice(STATIC_PREFIX.length));
  } catch {
    return null;
  }
  const candidate = resolve(distDir, decoded);
  const within = relative(distDir, candidate);
  if (within.startsWith("..") || within.startsWith(sep) || within === "") return null;
  return candidate;
}

async function serveFile(path: string, cacheControl: string, res: ServerResponse) {
  const stats = await stat(path);
  if (!stats.isFile()) throw new Error("not a file");
  res.writeHead(200, {
    "content-type": contentTypeFor(path),
    "content-length": stats.size,
    "cache-control": cacheControl,
  });
  // Headers are already out, so a read error mid-stream cannot become a status
  // code. Destroy the response instead of letting the stream throw and take the
  // process with it.
  const body = createReadStream(path);
  body.on("error", (error) => {
    console.error(`read error serving ${path}`, error);
    res.destroy();
  });
  body.pipe(res);
}

function fail(res: ServerResponse, status: number, message: string) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(`${message}\n`);
}

const server = createServer((req, res) => {
  // Every path out of here must answer or fail. An unhandled rejection is fatal to
  // the process under Node's default, so one bad request would take the block down
  // until the container restarted.
  void handle(req, res).catch((error: unknown) => {
    console.error("unhandled request error", error);
    fail(res, 500, "Internal server error");
  });
});

async function handle(req: IncomingMessage, res: ServerResponse) {
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;

  if (pathname.startsWith(STATIC_PREFIX)) {
    const file = resolveStaticFile(pathname);
    if (file) {
      try {
        // Built assets are content-hashed, so they are safe to cache hard. Files
        // copied verbatim from public/ are not, but they are a handful of icons.
        await serveFile(file, "public, max-age=31536000, immutable", res);
        return;
      } catch {
        // Fall through to the 404 below.
      }
    }
    // A miss under the static path is a genuine 404, not a page route. Static paths
    // skip node lookup, so this really is ours to answer. Serving the shell would
    // answer a hashed JS or CSS request with 200 text/html, failing the module load
    // in the browser with nothing to diagnose from.
    fail(res, 404, "Not found");
    return;
  }

  // ROUTING. resolveIdentity from `packages/routing` runs here, on the real inbound
  // request, and its output is rendered into the page by ./panel.ts. Step 1b (the node
  // fetch) still does not exist, so this resolves an identity and stops: no node, no
  // entry, no content-type dispatch. Do not dispatch on the path -- it is `/` in local
  // dev, the friendly URL under enableFullUriRouting, and an endpoint path otherwise.
  //
  // Importing `routing` ended this image's zero-runtime-dependency property. The runtime
  // stage now ships the packed package at node_modules/routing rather than bundling this
  // server, so `node server/index.ts` still runs the file you can read. Node refuses to
  // strip types from anything under a real node_modules path, which is why the image
  // needs the packed JavaScript and cannot just copy the source across. See
  // docker/routing-runtime-package.json.
  //
  // Every path still serves the shell with a 200. That is right today for a reason worth
  // being precise about: a path with no node never reaches the block, so everything
  // arriving here has already resolved. 404s belong to the platform, which goes block ->
  // Classic Contensis -> a cached 404 page on its own.
  //
  // It is NOT because a 404 is expensive and 200 is safer. Once routing fetches the
  // node, a fetch that fails should 404 and let that chain run; serving the shell
  // instead would be a soft 404. See .knowledge/contensis-block-runtime.md.

  // req.url goes in verbatim, path and query together, which is what ResolveIdentityInput
  // documents. The resolver discards the query itself.
  const resolution = resolveIdentity({ headers: req.headers, url: req.url ?? "/" });
  if (resolution.diagnostics.length > 0) {
    // The resolver has already dropped the malformed values, so this is the record
    // rather than the handling. Something upstream sent an id that is not a GUID.
    console.warn("routing diagnostics", resolution.diagnostics);
  }

  // The shell can no longer be streamed: the panel makes the body per-request, so
  // content-length has to be recomputed. A stat-derived length is only correct for a
  // verbatim file, and a string length would be wrong for any non-ASCII header value.
  let shell: string;
  try {
    shell = await readShell();
  } catch {
    fail(res, 500, "dist/index.html is missing; the app was not built");
    return;
  }

  // The resolution is passed in rather than resolved a second time, so the panel cannot
  // report a different answer from the one this server acted on.
  const body = Buffer.from(injectPanel(shell, collectPanelData(req, resolution)), "utf8");
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "content-length": body.byteLength,
    "cache-control": "no-cache",
  });
  res.end(body);
}

server.listen(port, "0.0.0.0", () => {
  console.log(`website listening on http://0.0.0.0:${port}, serving ${distDir}`);
});
