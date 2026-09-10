import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";

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

  // ROUTING SEAM. This is where resolveIdentity({ headers, url }) from
  // `packages/routing` will go, once step 1b (the node fetch) exists: read
  // x-node-id, fetch the node, and render for that identity. Do not dispatch on
  // the path -- it is `/` in local dev, the friendly URL under
  // enableFullUriRouting, and an endpoint path otherwise.
  //
  // Wiring routing in also ends this image's zero-runtime-dependency property:
  // the runtime stage will then need a `deps` stage or a bundled server.
  //
  // Until then every path serves the shell with a 200. That is right today for a
  // reason worth being precise about: a path with no node never reaches the block,
  // so everything arriving here has already resolved. 404s belong to the platform,
  // which goes block -> Classic Contensis -> a cached 404 page on its own.
  //
  // It is NOT because a 404 is expensive and 200 is safer. Once routing fetches the
  // node, a fetch that fails should 404 and let that chain run; serving the shell
  // instead would be a soft 404. See .knowledge/contensis-block-runtime.md.
  try {
    await serveFile(join(distDir, "index.html"), "no-cache", res);
  } catch {
    fail(res, 500, "dist/index.html is missing; the app was not built");
  }
}

server.listen(port, "0.0.0.0", () => {
  console.log(`website listening on http://0.0.0.0:${port}, serving ${distDir}`);
});
