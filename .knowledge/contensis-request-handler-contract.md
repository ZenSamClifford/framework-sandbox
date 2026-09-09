---
applies_to: Contensis blocks serving pages behind the Request Handler (framework-sandbox, react-crb, node)
keywords:
  [
    request handler,
    nodeId,
    entryId,
    x-node-id,
    x-entry-id,
    site view,
    renderer,
    endpoint,
    enableFullUriRouting,
    block,
    staticPaths,
    dev requests,
    local development,
    preview,
    IIS fallback,
  ]
type: standard
description: What the Contensis Request Handler delivers to a block, and how to run one locally
---

# Contensis Request Handler Contract

What a Contensis block actually receives from the Request Handler, and how to run a handler locally. Verified against source in all three repos plus live captures from a deployed block and a locally run handler (September 2026).

Every claim below is marked **confirmed** (read in source or observed live) or **inferred**. Do not treat the inferred items as fact.

## What the handler is, and who owns what

The Request Handler resolves a friendly URL against the site view and rewrites it to something the block can serve. It is Contensis-owned. A block consumes its output; it never implements one.

Three repos, and their real relationship (confirmed):

| Repo                                         | Role                                                                                                                                                                        |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `zengenti/contensis-svc-request-handler`     | The deployed service. **Only** the Host adapter layer: gRPC clients, memory cache, HttpContext cache keys. Private.                                                         |
| `contensis/request-handler-localdevelopment` | Owns the **entire routing and rewrite core**. Declared as a git submodule of the service repo above, which builds against its `Application` and `Domain` projects. Private. |
| `contensis/cli`                              | Wraps the localdevelopment binary. Does not reimplement or vendor it.                                                                                                       |

The submodule pin matches localdevelopment's `main` HEAD, so **read the contract in the localdevelopment repo**. It is the authoritative source, not the service repo.

## Query params

Node identity arrives as the `x-node-id` and `x-entry-id` **request headers**, set unconditionally. **These are the durable channel** (confirmed live: a block pushed 2026-08-13 got no injected query params at all, only the headers).

`?nodeId`/`?entryId` are legacy: blocks pushed before a hardcoded `2025-11-03 09:00` cutoff (`RouteInfoFactory.cs`) got the old `/generic-page?entryId=x&nodeId=y` shape, but nothing is injected for blocks pushed after it. Not worth designing for.

Also confirmed: an `originPath` param is written in code but its return value is discarded (`QueryString` is a readonly struct), so it's a no-op. No `language`, `versionStatus` or `projectId` params are appended either.

## What the block receives

### Request headers

Always present (confirmed): `x-node-id`, `x-entry-id`.

Everything inbound is forwarded **except** a 22-entry denylist in `RequestHeaderMappingService.DisallowedRequestHeaderMappings`. Notably denied: `Host`, `Accept-Encoding`, `x-site-type`, `x-alias`, `x-project-api-id`, `x-project-uuid`, `x-block-config`, `x-proxy-config`, `x-renderer-config`, `x-iis-hostname`, `x-loadbalancer-vip`, `traceparent`, `x-forwarded-proto`.

So **a block cannot read alias, project or site type from the request.** Take them from block config or env.

Sending `x-requires-*` headers (`x-requires-alias`, `-project-api-id`, `-node-id`, `-entry-id`, `-entry-language`, `-block-id`, `-version-no`) forwards those hint headers to the block and makes the handler emit the corresponding values as **response** headers, for the cache and CDN layer. Confirmed live: they do **not** appear as request values. They are not an app input.

### The path

**Confirmed from source:** the path is CMS configuration, not app routing. Resolution chain is node → `contentTypeId` or `rendererRef` → renderer rules → `endpointId` → block endpoint path. A path like `/generic-page` would be a **declared block endpoint**, never a route the app invents.

But the block's `enableFullUriRouting` flag overrides this: when true, `path = originUri.AbsolutePath` and the block receives the **friendly URL** directly.

Both shapes are live-possible, and only one has been observed. On `uol` / `universityDemo` the `sandbox` block has `endpoints: []`, `enableFullUriRouting: true`, and both renderers return `endpointId: null`, so it simply receives `/accessibility`. **The endpoint-path shape has not been observed on any accessible project.** Do not hardcode either assumption.

Read a block's actual config with:

```bash
contensis get block <block-id> <branch> <version> --format json   # enableFullUriRouting, endpoints, staticPaths, port
contensis get renderer <renderer-id> --format json                # rules[].return.endpointId
```

### Getting the friendly path

Since `originPath` is a no-op and the path may be an endpoint path, **fetch the node from the Delivery API using `x-node-id`**. That is the only reliable source for canonical URLs, breadcrumbs and self-links.

### Static assets

**Confirmed:** assets must live under a declared static path, and `/static` is injected as the default when a block declares none (observed: block config `staticPaths: []`, debug data `staticPaths: ["/static"]`). Any declared path containing `*` is discarded.

Served JS and CSS have asset paths rewritten to a `/_{hash(projectUuid)}_{blockVersionId}/` prefix; requests arriving on that prefix skip node lookup and are stripped back before hitting the block. **Absolute asset paths outside a declared static path will not resolve.** This constrains bundler `base` config directly.

**Confirmed from a deployed capture** (`evidence/captures-uol/sandbox.body`, the real `sandbox` block's rendered HTML). Every asset URL has the shape:

```
/_saOKKg_432245b3-59f0-4dba-b7e9-f92a6bb32d14/static/modern/js/app.<hash>.mjs
/_saOKKg_432245b3-59f0-4dba-b7e9-f92a6bb32d14/static/icon/favicon.ico
```

Three things follow, all previously open:

- **The prefix and the static path compose.** It is `/_{hash}_{blockVersionId}` _followed by_ `/static/...`, not one replacing the other. A `/static/`-based build therefore survives the rewrite. This was marked unverifiable in local dev; it is now verified from a deployed capture.
- **`/static` is a real path the block serves,** not an alias the handler invents. The block's own emitted URLs contain it. So a bundler needs the files to land under `dist/static/` as well as emitting `/static/` URLs: `base: "/static/"` alone is not enough, it needs `build.outDir: "dist/static"` too (or a runtime server that mounts `dist` at `/static`).
- The block links `href="/accessibility#main"` because it dispatched on the **request path**, not from a node fetch. See "What a real block actually does" below.

### Root files

**Confirmed by absence:** no special case for `robots.txt` or `ads.txt`. They resolve only via a site view node, a declared static path, or a separate block. Only `/favicon.ico` is special-cased, and only to skip node lookup.

### Preview

Server type arrives as `x-site-type`, which is **on the denylist**, so the block never sees it. Read preview state from the globals the handler injects into HTML before `</body>`: `window.ContensisProjectApiId`, `ContensisAlias`, `ContensisSso`, `ContensisEntryVersionStatus`, `ContensisEntryId`, `ContensisEntryLanguage`, `ContensisVersionNumber`.

**Inferred, worth raising upstream:** `SetPreviewToolbar` reads `entryId` from the query string, which post-cutoff no longer exists, so `window.ContensisEntryId` is likely emitted empty on new blocks.

Version-config query params and `previewSecurityToken` are stripped by a 301 and persisted as cookies (`previewSecurityToken` deliberately not HttpOnly, so the toolbar can read it).

### 404s

**Confirmed:** a 404 from the block triggers an **IIS fallback round-trip**, which may serve IIS content in its place. If the app 404s for unknown routes, expect a second upstream request. Excluded from the handler entirely: `/pingz`, `/healthz`, `/infoz`, `/livez`, `/api/preview-toolbar/blocks`.

## Running a handler locally

```bash
contensis connect <alias>
contensis login <username>
contensis set project <projectId>
contensis list blocks
contensis dev requests <block-id> http://localhost:3000 --args --port=5001
```

Node and renderer resolution in local dev are **real**, hitting the live CMS over HTTPS. Fidelity is higher than it looks. But there are three divergences and two setup blockers.

### Two setup blockers

1. **Port 5000 collides with macOS AirPlay Receiver.** `ControlCenter` holds `*:5000` and the CLI never passes `--port`, so the handler dies with `System.IO.IOException: Failed to bind to address http://[::]:5000: address already in use.` Reproduced verbatim. Pass `--args --port=5001`, or disable AirPlay Receiver.

2. **The CLI cannot fetch its own binary.** `GitHubCliModuleProvider.FindLatestRelease` calls `api.github.com/repos/contensis/request-handler-localdevelopment/releases` **unauthenticated**, and that repo is private, so it 404s and the command dies with "Unable to get releases". There is no token support in the provider, and `--release` does not help (it fetches the full list first, then filters).

   Workaround, confirmed working:

   ```bash
   gh release download <tag> --repo contensis/request-handler-localdevelopment \
     --pattern 'Distributable.for.osx-arm64.zip' -O rh.zip
   unzip -q rh.zip -d ~/.contensis/request-handler-localdevelopment-<tag>/
   chmod +x ~/.contensis/request-handler-localdevelopment-<tag>/Zengenti.Contensis.RequestHandler.LocalDevelopment
   # then pin it so the CLI skips the release lookup:
   # ~/.contensis/cli-manifest.json →
   #   {"request-handler-localdevelopment":{"github":"contensis/request-handler-localdevelopment","version":"<tag>"}}
   ```

   Pinning a concrete version makes `downloadImmediately` false, so the failing GitHub call fires unawaited and no longer blocks startup. Side effect: the handler will no longer auto-update.

### Three divergences from production

- **The block override loses the path.** The override passes `endpointId: null` and discards the endpoint URI, so `baseUri.AbsolutePath` is `/`. There is a `// TODO: deal with endpoints` in that code. Confirmed live: a request a deployed block receives as `/accessibility` arrives locally as `/`. **An app that dispatches on the path will pass locally by accident and only break once deployed.**
- **`enableFullUriRouting` is hardcoded false** in the override path, and server type always defaults to `preview`. Confirmed to be a real divergence, not a reporting artefact: the block version genuinely has the flag true. The local `blockVersionInfo` is partly synthesised, which its zeroed `projectUuid: 00000000-0000-0000-0000-000000000000` gives away.
- **No cache keys emitted.** Local dev binds `NullCacheKeyService`. Only _observation_ needs a deployed block; the contract itself is readable in source, below.

Also local-only: `block-versionstatus=live`, `proxy-versionstatus=published`, `renderer-versionstatus=published` and language `en-GB` are hardcoded defaults, where the real service takes them from headers. There is no IIS fallback on `/` (deliberate, so the root path can be debugged).

## Verifying against a live block

`x-debug: true` on a request to a staging or preview host returns a `request-handler-debug-data` response header with the resolved `nodeInfo`, `routeType`, rewritten `uri`, `blockVersionInfo` and `appConfiguration`. It also returns an `endpointErrorCurl` reproducing the exact outbound request, which is the fastest way to confirm the header contract without reading source.

```bash
curl -sS -L -D headers.txt -o body.html -H 'x-debug: true' \
  'https://staging-<project>-<alias>.cloud.contensis.com/<path>'
```

To see exactly what a block receives locally, put a header-dumping server on the override port and read its output. That is how the header contract above was confirmed.

## Checklist for a framework consuming this

1. Read `x-node-id` / `x-entry-id` headers. Ignore `?nodeId`/`?entryId`, legacy and no longer emitted.
2. Fetch the node from the Delivery API by id. Never derive canonical URLs from the request path or `location`.
3. Do not assume the path. It is `/` in local dev, the friendly path under full URI routing, and an endpoint path otherwise.
4. Take alias, project and language from config or env, never from the request.
5. Keep assets under a declared static path and tolerate the `/_{hash}_{blockVersionId}/` prefix rewrite.
6. Read preview state from the injected `window.Contensis*` globals.
7. Remember a 404 costs an upstream IIS fallback round-trip.

## What a real block actually does

Confirmed by pulling the deployed `sandbox` block image and running it locally behind the local handler (September 2026). The image is `gitlab.zengenti.com:4567/university-of-leicester/sandbox/main/app:build-3`; it is a Contensis React Base (CRB) SSR app, the current production framework.

### The block image's config surface

```
ExposedPorts: 3001/tcp                      # matches the block config `port`
Env:          NODE_VERSION=22.23.2
Entrypoint:   node --max-http-header-size=800000 dist/server/launcher.js \
                --alias=$alias --projectId=$projectId --accessToken=$accessToken
WorkingDir:   /usr/src/app
```

So the block runtime supplies **`alias`, `projectId` and `accessToken` as environment variables**, which the entrypoint turns into CLI args. That is the config channel the contract's "take alias and project from config or env" refers to, made concrete. Nothing about the request is involved.

Run it locally with:

```bash
docker run -d --name uol-sandbox --platform linux/amd64 -p 3002:3001 \
  -e alias=uol -e projectId=universityDemo \
  gitlab.zengenti.com:4567/university-of-leicester/sandbox/main/app:build-3
```

The image bakes an `.env` (`ALIAS`, `ACCESS_TOKEN`, `PUBLIC_URL`, `PROJECT`) and a pre-generated `dist/server/start.universitydemo.uol.js`, so it starts and serves live content with no token passed in. It logs `Serving static assets from: "/dist/static/"`.

### CRB dispatches on the path, and only on the path

Requests made directly to the container on port 3002:

| Request                                      | Rendered               |
| -------------------------------------------- | ---------------------- |
| `GET /`                                      | React Starter home     |
| `GET /accessibility`                         | **Accessibility page** |
| `GET /` + `x-node-id` + `x-entry-id` headers | React Starter home     |
| `GET /?nodeId=…&entryId=…`                   | React Starter home     |
| `GET /generic-page`                          | 404                    |
| `GET /does-not-exist-xyz`                    | 404                    |

Those alone cannot separate "ignores the headers" from "path wins over headers", since `/` should render home either way. The discriminating tests point the headers at a _different_ node than the path:

| Request                                                 | Rendered          |
| ------------------------------------------------------- | ----------------- |
| `GET /accessibility` + headers naming the **Home** node | **Accessibility** |
| `GET /` + headers naming the **Accessibility** node     | **Home**          |
| `GET /?nodeId=<accessibility>&entryId=<accessibility>`  | **Home**          |

The headers have no effect in either direction. **CRB routes solely on the URL path**, ignoring `x-node-id`, `x-entry-id` and the pre-cutoff query params alike. The header channel that the handler guarantees is not consumed by the production framework at all.

`/generic-page` 404ing also confirms the endpoint-path shape is unused here: CRB depends on `enableFullUriRouting` being on.

### The local dev loop is broken for CRB too

The headline result. With the local handler on 5001 forwarding to the container on 3002:

```
GET http://localhost:5001/accessibility
  → handler sends: GET http://localhost:3002/
  → block renders: React Starter home, 200
```

Requesting a page through the local handler renders **the homepage**, because the handler's block override drops the path (see the divergences above) and CRB has nothing else to route on. This is not a gap specific to a new framework; **every page renders as the homepage under `contensis dev requests` today**, for the current production framework. That reframes the divergence from "our problem to solve" into "a known upstream gap everyone works around", and it is worth raising with Contensis.

Practical consequence: a framework that reads `x-node-id` and fetches the node would actually be _more_ correct under local dev than CRB is, because the headers survive where the path does not.

### The asset prefix, corrected

The `/_{hash}_{blockVersionId}/` rewrite **is applied in local dev**, contrary to the earlier assumption that a synthesised zero `projectUuid` prevents it. Locally the block version id is real and only the hash differs:

```
deployed: /_saOKKg_432245b3-59f0-4dba-b7e9-f92a6bb32d14/static/modern/js/app.<hash>.mjs
local:    /_C+6CLA_432245b3-59f0-4dba-b7e9-f92a6bb32d14/static/modern/js/app.<hash>.mjs
```

Note the hash alphabet includes `+`, so the prefix is not URL-safe base64. Both the raw and percent-encoded forms resolve.

Through the handler on 5001:

| Request                                                     | Result  |
| ----------------------------------------------------------- | ------- |
| `/_C+6CLA_<blockVersionId>/static/modern/js/app.<hash>.mjs` | **200** |
| `/static/modern/js/app.<hash>.mjs` (unprefixed)             | **404** |

**Only the prefixed form resolves through the handler.** An unprefixed `/static/...` is treated as a friendly URL, finds no node, and 404s. Assets work because the handler rewrites the literal `/static/...` strings inside served HTML, JS and CSS on the way out. Anything a bundler constructs at runtime rather than emitting as a literal string will not be rewritten and will 404.

Against the container directly, both `/static/robots.txt` and `/robots.txt` return the same file, so CRB mounts `dist/static` at the root as well. That root mount is incidental: the handler only forwards declared static paths, so only `/static` is reachable in a block.

### What this means for a bundler

`dist/static/` is a real directory in the CRB image, and the emitted URLs are `/static/...`. So a Vite build needs **both**:

- `base: "/static/"` so the emitted URLs carry the prefix the handler rewrites, and
- `build.outDir: "dist/static"` (or a runtime server that mounts `dist` at `/static`) so the files exist at the path being requested.

Setting `base` alone is not sufficient.

### The echo block

The echo block (built during spike one and not carried into this repo) is the deployed equivalent of the local header sink: a Node server that renders the method, path, query and every request header, serves the real Vite build at `/static`, and emits the built asset tags so the handler's rewrite applies to the same response. `?__json` returns the same payload as JSON for scripted captures. It never 404s, so it cannot be replaced by IIS fallback content.

A static SPA is mute about path shape, headers and the asset prefix, which are exactly the things a deployed push is meant to answer. Push the echo image, not the nginx one, when the question is "what does a deployed block receive".

Validated locally behind the handler; it reproduces the header-sink result exactly:

```
GET localhost:5001/accessibility?__json
  pathname: /            <- friendly path dropped, as expected in local dev
  query:    {__json: ""} <- inbound query params ARE preserved
  headers:  x-node-id, x-entry-id, host, accept, user-agent, content-length, traceparent
```

Two details this adds to the contract:

- **Inbound query params are forwarded.** Only `nodeId` and `entryId` are stripped. Anything else a client sends arrives intact, so query state is a usable channel.
- A `content-length: 0` is added to the forwarded GET.

### The 404 trade-off a static build forces

A single-page build served with an SPA fallback (`try_files $uri /index.html` or equivalent) returns 200 for every path, so **the app can never signal "not found" to the handler**. That avoids the IIS fallback round-trip, but it also turns a genuinely missing page into a 200 serving an empty shell rather than a 404 that falls back upstream.

This is a behavioural decision, not an nginx default to accept silently. A framework that fetches the node by id can do better: 404 when the node lookup fails, and serve the shell otherwise.

## Read from source, not from a deployment

Three items previously filed as "needs a deployed block" are fully answered by the source. Reading it is cheaper and more authoritative than pushing a test block.

Both repos are cloned at `departments/product-development/svc/contensis-svc-request-handler`. The localdevelopment repo, which owns the routing core, is the **git submodule** inside it, so one clone gets both and the submodule is pinned to exactly what the service builds against:

```
contensis-svc-request-handler/
  src/Zengenti.Contensis.RequestHandler/Services/Caching/   <- cache keys (Host layer)
  request-handler-localdevelopment/src/
    …Domain/ValueTypes/RouteInfo.cs                         <- the asset path prefix
    …Domain/Common/Keys.cs                                  <- xxHash32
    …Domain/Extensions/BlockExtensions.cs                   <- default static path
    …Application/Services/RouteInfoFactory.cs               <- endpoint vs friendly path
```

Re-clone with `git clone --recurse-submodules`; a plain clone leaves the submodule directory empty and the routing core missing. Verified on clone: the pin equals the localdevelopment `main` HEAD (`e44e2f5`), so there is no drift between what you read and what runs.

### Cache keys

`src/Zengenti.Contensis.RequestHandler/Services/Caching/CacheKeyServiceBase.cs`. The whole contract:

- The **block emits `surrogate-key` response headers**. That is the only thing a framework has to do.
- The handler splits them on whitespace, and hashes any key longer than 6 characters with `Keys.Hash`. `AnyEntryUpdate` and `AnyUpdate` are passed through unhashed.
- Keys are deduped and joined with spaces into the outgoing `surrogate-key`.
- If the joined value exceeds **32kB**, the whole thing collapses to `AnyUpdate`, i.e. everything invalidates on any change. Worth staying well under.

### The asset path prefix, computed

`request-handler-localdevelopment/src/…/Domain/ValueTypes/RouteInfo.cs` and `…/Domain/Common/Keys.cs`:

```
RoutePrefix = "_" + xxHash32(projectUuid.ToString().ToLowerInvariant())
                      .bytes(little-endian).base64().trimEnd('=').replace('/', '+')
            + "_" + blockVersionId
```

The hash is **xxHash32** (`System.Data.HashFunction.xxHash`, default seed), and `AsBase64String` emits the 4 hash bytes **little-endian**. Verified both ways against real observations:

| projectUuid                                               | computed             | observed             |
| --------------------------------------------------------- | -------------------- | -------------------- |
| `00000000-…-000000000000` (local dev)                     | `_C+6CLA_432245b3-…` | `_C+6CLA_432245b3-…` |
| `32a6a346-7893-a183-ee33-4199e73a0282` (`universityDemo`) | `_saOKKg_432245b3-…` | `_saOKKg_432245b3-…` |

So the deployed prefix for any project is computable without deploying anything. The `/`→`+` substitution is why the alphabet is not URL-safe base64.

### Endpoint path vs friendly path

`request-handler-localdevelopment/src/…/Application/Services/RouteInfoFactory.cs`, in `Create`:

```csharp
var path = baseUri.AbsolutePath;                 // the block endpoint's path
…
if (enableFullUriRouting && originUri != null)
    path = originUri.AbsolutePath;               // the friendly URL instead
```

That is the entire fork. The unobserved `/generic-page` shape is simply `baseUri.AbsolutePath` where `baseUri` comes from the block's declared endpoint. **Confirmed from source**; observing it on a configured project would only re-confirm a two-line branch. It is no longer an open question, just an unexercised configuration.

Also visible here: `originPath` is added to the query string only when full URI routing is **off**, and the `RouteInfo` return discards it regardless.

### Partial path matching

`request-handler-localdevelopment/src/…/Application/Services/RouteService.cs`, in `GetRouteForRequest`. When no node exists at the exact path, node resolution returns the **nearest ancestor node**, flagged as:

```csharp
var isPartialMatchPath = !node.Path.EqualsCaseInsensitive(originPath);
```

The two dispatch keys are treated asymmetrically:

- `node.ContentTypeId` is passed to `GetRouteInfoForRequest` **unconditionally**, so content-type routing survives a partial match.
- `rendererRefId` is set only when `!isPartialMatchPath || node.RendererRef.IsPartialMatchRoot`, so a node with an explicit renderer ref serves sub-paths only if that flag is set. Same rule for `ProxyRef` via `ProxyRef.PartialMatch`.

So `/search/:facet` needs **one** node at `/search`, not a node per value. The block receives the ancestor node's id and, under full URI routing, the full requested path, making the remainder `requestPath - node.path`. Local dev drops the path, so the remainder is not testable there.

`NodeInfo` is built from `node.Id`, `node.EntryId` and `node.Path`, the **node's** path, not the requested one.

Also here: `cacheKeyService.AddRange(node.CacheKeys)`, so node cache keys are contributed by the handler without the app doing anything.

### Default static path

`request-handler-localdevelopment/src/…/Domain/Extensions/BlockExtensions.cs`: static paths containing `*`, blank, or reducing to `/` are dropped; if none survive, `/static` is added. Confirms the observed `staticPaths: []` → `["/static"]`.
