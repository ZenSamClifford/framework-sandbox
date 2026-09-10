---
applies_to: the HTTP server inside a Contensis block, and any framework that generates one
keywords:
  [
    block server,
    unhandled rejection,
    crash,
    availability,
    port,
    static mount,
    404,
    IIS fallback,
    asset prefix,
    blockVersionId,
    surrogate-key,
    staging url,
    verification,
  ]
type: standard
description: What a block's HTTP server has to do to stay up and serve correctly, and how to verify one once it is deployed
---

# What a block's server must do

A block is a **long-lived process** that Contensis starts and then routes traffic to. It
is not invoked per request, and nothing restarts it between requests. Everything below
follows from that, or from the Request Handler contract in
`contensis-request-handler-contract.md`, which is the binding document and is not
restated here.

Worked example: `apps/website/server/index.ts`, about 100 lines with no dependencies.

## Staying up is a correctness requirement, not an ops concern

**One unhandled rejection is a full outage, not a failed request.** Node's default for an
unhandled rejection is to terminate. In a block that means every subsequent request fails
until the container is restarted.

This is not hypothetical. `GET /static/%` took this repo's server down on the first
version written:

```
$ curl localhost:3001/static/%    # empty reply
$ curl localhost:3001/            # empty reply: the process is gone
```

`decodeURIComponent` throws `URIError` on a malformed escape, and the throw was inside an
`async` IIFE nobody awaited. The URL is attacker-controlled and one request was enough.

Three rules that follow. They are cheap, and each one closes a hole the others do not:

1. **Every request goes through one function whose rejection is caught.** Not a
   `try`/`catch` around the risky-looking parts, which is what missed the case above:

   ```ts
   createServer((req, res) => {
     void handle(req, res).catch((error: unknown) => {
       console.error("unhandled request error", error);
       fail(res, 500, "Internal server error");
     });
   });
   ```

2. **Guard every parser that takes request input.** `decodeURIComponent` and `new URL`
   both throw on input a client fully controls. Return a value, do not throw.

3. **Attach an `error` handler to any stream piped to the response.** Once headers are
   sent a read error cannot become a status code, so destroy the response. Without the
   handler the stream throws and takes the process with it.

A responder that tolerates being called twice is worth the five lines, because the second
call otherwise throws inside the error path itself:

```ts
function fail(res: ServerResponse, status: number, message: string) {
  if (res.headersSent) return void res.destroy();
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(`${message}\n`);
}
```

## Serving the build

Port **3001**, bound to **0.0.0.0**. 3001 is the block default and what the CRB image
exposes; take it from `PORT` with 3001 as the fallback. Binding to `localhost` makes the
container unreachable from outside itself.

The files have to exist at the path being requested, which for a Vite build means one of
two things, not `base` alone:

- `base: "/static/"` plus `build.outDir: "dist/static"`, or
- `base: "/static/"` plus a server that **mounts `dist` at `/static`**.

This repo uses the second, and it is verified deployed. Neither is more correct; the mount
keeps `index.html` at `dist/index.html` and avoids a nested path in the image.

Resolve the build directory **from the module, not the working directory**:

```ts
const distDir = resolve(import.meta.dirname, "../dist");
```

A cwd-relative path works in the container and breaks the moment anyone runs the server
from the repo root, which is exactly what a local verification step does.

Reject anything that escapes the build directory after `resolve`, and treat a malformed
escape as a miss rather than a throw:

```ts
const within = relative(distDir, candidate);
if (within.startsWith("..") || within.startsWith(sep) || within === "") return null;
```

## 404s are the platform's job, not the app's

**A path with no node never reaches the block.** Confirmed against our own deployed block
(`evidence/captures-prs/block-404-routing.capture.log`):

| Request               | `routeType`   | Who answered                            |
| --------------------- | ------------- | --------------------------------------- |
| `/`                   | `Block`       | the block, 1039 bytes, our shell        |
| `/does-not-exist-xyz` | none emitted  | the platform, 32852 bytes, its 404 page |
| `/some/sub/path`      | `IisFallback` | IIS, with `nodeInfo: null`              |

On the missing paths there is no `request-handler-debug-data` and `blockVersionInfo` is
`null`. The handler resolved no node, so the request never became a block route at all.
The chain is **Block, then Classic Contensis, then a simple 404 page from cache**, and it
runs whether or not the block exists.

So an app cannot decide a 404 for a missing page, because it is never asked about one. A
framework should not try to own this, and should **not** manufacture a 200 to avoid it:
returning a shell where the platform would have served a 404 is a soft 404, which defeats
the chain, misreports to crawlers, and caches "this page exists".

Where a block-originated 404 genuinely can happen:

- **A resolved node whose content the app then cannot render** — the node fetch fails, or
  the entry is gone. This is the real decision point, and it only exists once routing does
  the fetch. The node already resolved, so this means something is inconsistent rather
  than missing; 404 and let the chain run.
- **A request under a declared static path**, which skips node lookup and goes straight to
  the block. A miss there should 404 rather than serve HTML: answering a hashed JS request
  with `200 text/html` fails the module load with nothing to diagnose from.

What this repo's server does today: 404 for a miss under `/static/`, and the shell for
everything else. The second is correct only because everything else that arrives has
already resolved to a node, **not** because a 404 is being avoided as expensive. Revisit
the moment a node fetch exists that can fail.

An earlier note in `packages/routing/.knowledge/routing-design.md` framed this as a free
choice between "404 and accept the round-trip" and "200 with a not-found page, keeping
control". That framing overstated the app's role, and is corrected there.

## Two things that change per deployment

**The asset prefix contains the block version id, so it changes on every push.** From this
repo's own block, same project, consecutive versions:

```
v1  /_5j8wRw_4fbfc795-553b-4ee4-8823-d68960be158e/static/assets/index-CgEoLifo.js
v2  /_5j8wRw_7c0df438-11fd-43ac-90b7-91f42e83defd/static/assets/index-CgEoLifo.js
```

The hash half is derived from the project uuid and is stable; the block version id half is
not. Anything that hardcodes, caches or persists a whole prefix breaks on the next
release. The app never needs to construct one: the handler rewrites literal `/static/...`
strings on the way out, which is why every asset URL must be a **bundler-emitted literal**
rather than something assembled at runtime.

**`window.ContensisEntryId` is emitted empty** on any block pushed after the 2025-11-03
cutoff. Read preview state from the other injected globals and get the entry id from
`x-entry-id` instead.

## Verifying a deployed block

Do this, rather than trusting a green local run. Local dev drops the friendly path, so a
path-based design passes locally and fails deployed.

```bash
contensis get block <block-id> <branch> <version> --format json
```

Check `enableFullUriRouting` (proves the manifest was read), `image.status`, `port`, and
`status.running` in **all three data centres**, not just `global`.

Then fetch the staging URL. **Use a cookie jar or you will get an empty body**: the
version-config query params are stripped by a 301 and persisted as cookies, so a redirect
followed without one lands on the plain host with no version pinned.

```bash
curl -sS -L -c jar -b jar -o body.html \
  'https://staging-<project>-<alias>.cloud.contensis.com/?block-<id>-versionno=<n>'
```

In `body.html` every asset URL must carry the `/_{hash}_{blockVersionId}/` prefix. A bare
`/static/...` means the rewrite did not fire and that asset will 404. Then request the
assets themselves, including any referenced from **inside** the built JS, which is where a
non-literal URL shows up as a miss. Add `-H 'x-debug: true'` to get the
`request-handler-debug-data` response header with the resolved node and rewritten uri.

## Not yet exercised

- **Cache keys.** The block emits `surrogate-key` response headers and the handler hashes
  and merges them; nothing in this repo emits any yet. Contract in
  `contensis-request-handler-contract.md`.
- **Health endpoints.** `/pingz`, `/healthz`, `/infoz`, `/livez` are excluded from the
  handler entirely, so they are available for a block to use. This repo's server does not
  implement them.
- **Graceful shutdown.** Nothing here handles `SIGTERM`, so in-flight requests are cut on
  redeploy.
