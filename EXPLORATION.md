# Perfect framework

The living plan for replacing CRB. Parts of it were written during spike zero and are a
record of how we reached the current position rather than open work.

**Where things stand.** Spike zero is done and its findings are settled in `.knowledge/`.
Routing step 1a is built in `packages/routing`. Spike one was built and Dockerised as
throwaway scratch work: it ran behind a local handler and was never pushed as a block
version, and it is not carried in this repo. Spike two, the islands proof, is next, and the
Tier 1 rendering fork below is still the blocking decision.

Reference material is in `.knowledge/` (the Request Handler contract, the Vite+ toolchain
notes, the test environments), routing specifics are in `packages/routing/.knowledge/`,
and the raw captures everything rests on are in `evidence/`.

Move from using Contensis React Base which is used on projects starting with React Starter to a new framework for use within Professional Services.

The wishlist below is grouped into three tiers: decisions that constrain everything else, spikes that can run independently in any order, and work deferred until the framework shape exists or until other people have input.

## Premises

Not decisions, these are the starting point.

- React
- Vite+

## Tier 1: constraining decisions

Nothing downstream is worth spiking until these are settled.

### Request handler contract

The request handler already exists and is not ours to build. It resolves a friendly URL against the site view and rewrites it to a route the block can serve. The framework's job is to render a webpage from that result, so what matters here is the shape of what arrives and how we run a handler locally during development.

Spike zero investigated this from source in all three repos, then live against both the deployed service and a locally run handler. Findings below are marked confirmed (read in source or observed live) or inferred. Raw captures are in `evidence/captures-uol/` (the `uol` work). The earlier `prs` attempts were all IIS fallback and of limited value, so only the note explaining why was carried over, as `evidence/prs-capture-notes.txt`.

- Works with Request Handler locally
  - Example request: `/drew → /generic-page?entryId=x&nodeId=y`
  - **This is the pre-cutoff contract and no longer applies to new blocks.** See below.
- The three references, and what each one is
  - https://github.com/zengenti/contensis-svc-request-handler is the actual request handler service that runs in front of a deployed block. Confirmed: it is only the Host adapter layer (gRPC clients, memory cache, cache keys). It declares `request-handler-localdevelopment` as a **git submodule** and builds against its `Application` and `Domain` projects.
  - https://github.com/contensis/request-handler-localdevelopment is therefore not just a harness: it **owns the entire routing and rewrite core**. The submodule pin matches its `main` HEAD, no drift, so this is where the contract is readable. Note it is a **private** repo, which matters below.
  - Contensis CLI: confirmed it wraps `request-handler-localdevelopment` rather than reimplementing it. `RequestHandlerFactory.ts` resolves the latest GitHub release, downloads the platform binary into `~/.contensis/`, and spawns it. Command is `contensis dev requests [block-id...] [local-uri]`; the handler listens on port **5000** (the CLI never passes `--port`).

### The query params are legacy

Confirmed from `RouteInfoFactory.cs`: there is a hardcoded cutoff of `2025-11-03 09:00`. For any block version pushed after it, `nodeId` and `entryId` are explicitly nulled out and **not appended to the query string**. Node identity then arrives only as the `x-node-id` and `x-entry-id` request headers, which are set unconditionally regardless of cutoff.

So a block pushed today receives the rewritten path with no injected query params at all. The headers are the durable channel.

Related, both confirmed: inbound `nodeId`/`entryId` params are stripped before injection so a client cannot spoof them; and on a 3xx from the block they are stripped back out of the `Location` header. An `originPath` param is written in code but its return value is discarded (`QueryString` is a readonly struct), so **the friendly path is never delivered as a query param**. It can still arrive as the path itself when the block has `enableFullUriRouting` on, which is the case on `uol`. No `language`, `versionStatus` or `projectId` params are appended either.

### What the framework has to do with it

- Read `x-node-id` / `x-entry-id` **headers** first, falling back to `?nodeId`/`?entryId` for pre-cutoff blocks
- Fetch the node from the Delivery API by id rather than trusting the path. Whether the block sees the friendly path at all depends on the block's `enableFullUriRouting` flag (true on the `uol` sandbox block, so it does there), and local dev hardcodes it false regardless. Since `originPath` is a no-op, the node is the only reliable source for canonicals, breadcrumbs and self-links
- Do not assume the path is ours to define. Confirmed from source: the rewritten path comes from CMS configuration (node → content type or renderer ref → renderer rules → endpoint → block endpoint path), so `/generic-page` would be a declared block endpoint rather than a route we invent. **But on `uol` no endpoint is configured at all** (`endpoints: []`, `endpointId: null`, full URI routing on), so the block simply receives the friendly path. Two viable shapes exist and only one is observed; the framework should not hardcode either assumption
- Serve static assets from a declared static path (default `/static`) and tolerate a `/_{hash}_{blockVersionId}/` prefix rewrite applied inside served JS and CSS. Absolute asset paths outside a declared static path will not resolve, which is a direct constraint on Vite's `base` config
- Take alias, project and language from block config or env, never from the request. Confirmed live: only `x-node-id` and `x-entry-id` reach the app; `x-requires-*` returns the rest as response headers for the cache layer, not as request input
- Read preview state from the injected `window.Contensis*` globals, not from headers: `x-site-type` is on the handler's 22-entry request header denylist, so the block never sees it. Alias and project are on that denylist too, unless the block opts in with `x-requires-*`
- Expect a 404 from the app to trigger an IIS fallback round-trip upstream, which may serve IIS content in its place

### Local dev fidelity, and one gap that matters

Node and renderer resolution in local dev are **real**, hitting the live CMS over HTTPS rather than being stubbed. Higher fidelity than assumed. But three confirmed divergences:

- **The block override loses the path.** The override passes `endpointId: null` and discards the endpoint URI, so `baseUri.AbsolutePath` is `/`. There is a `// TODO: deal with endpoints` in that code confirming it is known-incomplete. **Now confirmed live** against `uol`: the same request that a deployed block receives as `/accessibility` arrives locally as `/`. A framework that dispatches on the path would pass locally by accident and only diverge once deployed
- **No cache keys locally.** Local dev binds `NullCacheKeyService`, so none are emitted. Only observation is blocked: the contract is `surrogate-key` response headers from the block, readable in `CacheKeyServiceBase.cs`
- **`enableFullUriRouting` is hardcoded false** in the override path, and server type always defaults to `preview`. The block version genuinely has the flag set to `true` (confirmed via the Management API), so this is a real divergence rather than a reporting artefact. The local `blockVersionInfo` is partly synthesised, which the zeroed `projectUuid: 00000000-...` also gives away

### Routing

**Settled: route on node identity, not the request path.** Full recommendation and build order in `packages/routing/.knowledge/routing-design.md`, and step 1a of it is built. Not blocked on the rendering fork below, so it is the next thing to build.

### Rendering and hydration model

These two bullets pull against each other. Personalisation is runtime by definition and Forms needs client-side interaction, so "clean html/css with no hydration" cannot hold for all three packages.

- Static/dumb rendered content
  - Aim to serve clean html/css rather than bulky vendor bundles with hydration complication etc.
- Integrates with [Personalisation](https://github.com/contensis/experience-engine), [Forms](https://github.com/contensis/contensis-forms), [Canvas](https://github.com/contensis/canvas) (Contensis packages)

**Direction: explore islands first.** Static shell served as clean html/css, with selective hydration applied only to the Contensis packages that genuinely need a client runtime (Personalisation, Forms). This is the option that keeps both wishlist bullets honest rather than sacrificing one, so it gets the first spike.

Alternatives held in reserve if islands does not hold up:

- Full SSR + hydration (what CRB does today)
- SSG plus a small client runtime

This choice cascades into the state item, the migration path, and the component-level preview future goal.

### Web vs server split

Determines whether the request handler shim, root files and cache keys live in "web" or get pushed out to their own repos.

- Separate web from server (Express, sitemap, etc.)
  - Avoid app bloat by purposefully excluding server features
  - Other server features should be own repo rather than bolted into "web" repo
  - Example: make sitemap.xml a single repo using GitLab pipelines can be added as a block to any Contensis project

## Tier 2: independent spikes

Can be tackled in any order once Tier 1 is settled.

- Handle simple root files (robots.txt, favicon.ico, ads.txt etc.)
  - Confirmed: these are not free. `robots.txt` / `ads.txt` resolve only via a site view node, a declared static path, or a separate block. Only `/favicon.ico` is special-cased, and only to skip node lookup
- Link depth
  - Defaults to & works at 0, images should resolve (`sys.properties` width/height)
- Existing CRB features
  - i18n; https://www.contensis.com/help-and-docs/guides/authoring-and-managing-content/entries/multi-language-support, https://github.com/zengenti/contensis-react-base/tree/master/src/i18n
  - cache keys; https://www.contensis.com/help-and-docs/developers/guides/deployment/understanding-cache-keys-in-contensis
    - **Settled from source.** The block emits `surrogate-key` response headers; the handler hashes keys over 6 chars, dedupes, and collapses to `AnyUpdate` past 32kB. Local dev emits none (`NullCacheKeyService`), but there is nothing further to learn without one
- State
  - Disabled by default but easy to enable when needed
  - Options; [Redux store](https://redux-toolkit.js.org/), [Tanstack store](https://tanstack.com/store/latest), others?
- Simplify process from project init to CI/Block
  - Currently need to touch: .env, .gitlab-ci.yml, Contensis > apikeys & roles, GitLab > access_tokens & ci_cd#js-cicd-variables-settings
  - Block routing config is part of this surface: `enableFullUriRouting`, `endpoints` and `staticPaths` all decide what path and assets the app sees. `uol` runs with full URI routing and no endpoints, so the simple setup may be the right default
  - `contensis dev init` already automates part of this (it creates CMS API keys and roles, writes `.env`, `.gitignore` and CI files). Worth studying before building anything, but it is not read-only so do not run it casually

## Tier 3: deferred

Blocked on the Tier 1 outcomes, or on input from other people.

- Migration path from legacy CRB code base
  - Documentation / skill / codemod etc.
  - Scope is effectively the 33 skill files in `departments/professional-services/react-crb/.knowledge/`; that list is the replacement checklist
  - Shape depends on the rendering fork above
- Wider ownership, aka open source
  - Documentation and contribution path
- New/revised Search Package
  - TODO: Need to identify issues and shortcomings at the moment < @Mike Powell
- Component level preview
  - Helps with Contensis live entry preview
  - Constrained by the rendering fork above
- Type generation via OpenAPI
- Replacement for global entry data (replace Site Config double entry call)
  - TODO: clarify preferred solution (Speak to Rich Saunders? Single entry CT, Contensis docker variables)

## Test environment

Live CMS, with a specific block to test against. Sam has System Admin access and the CLI is authenticated.

- https://cms-uol.cloud.contensis.com/app/projects/universityDemo/blocks/sandbox
- Alias `uol`, project `universityDemo`, block `sandbox`
- Staging URL: `https://staging-universitydemo-uol.cloud.contensis.com?block-sandbox-versionno=3`
- The `sandbox` renderer is assigned to content type `contentPage`; `university-demo` is the catch-all (`*`). So any `contentPage` node routes to `sandbox`. At least 92 such nodes within three levels of the root; `/accessibility` was used for the captures.
- `sandbox` v3 was pushed **2026-08-13**, comfortably after the 2025-11-03 cutoff, which makes it a real test of the post-cutoff behaviour.

Raw captures in `evidence/captures-uol/`.

### Confirmed live, deployed

`GET /accessibility` with `x-debug: true` against the staging host returns `routeType: Block`, `blockId: sandbox`, `versionNo: 3` and:

- `uri: https://10.65.12.152/accessibility` with **no `nodeId` or `entryId` query params**. The cutoff behaviour is now confirmed live, not just from source.
- `enableFullUriRouting: true`, independently confirmed on the block version itself via `contensis get block sandbox main 3 --format json`, not just from the debug header. So it receives the **friendly path** directly.
- **The endpoint-path branch is not exercised anywhere on this project.** The block declares `endpoints: []`, and both renderers return `endpointId: null` in their rules (`contensis get renderer sandbox --format json`). Combined with full URI routing, that means nothing here ever produces a `/generic-page`-style path. The `/drew → /generic-page` shape remains unobserved here, but it is **settled from source**: `RouteInfoFactory` sets `path = baseUri.AbsolutePath` unless `enableFullUriRouting`, in which case the friendly path wins. Observing it would only re-confirm a two-line branch.
- `staticPaths: ["/static"]` in the debug data, while the block config declares `staticPaths: []`. That independently confirms the source finding that `/static` is injected as the default when a block declares none.
- The block declares `port: 3001`
- Asking for the echoes with `x-requires-node-id`, `x-requires-entry-id`, `x-requires-alias`, `x-requires-project-api-id`, `x-requires-entry-language`, `x-requires-block-id`, `x-requires-version-no` returns all of them as **response** headers (`x-node-id`, `x-entry-id`, `x-entry-language: en-GB`, `x-alias: uol`, `x-project-api-id: universityDemo`, `x-block-id: sandbox`, `x-version-no: 3`). These are for the cache and CDN layer, not inputs to the app.
- The `?block-sandbox-versionno=3` pin is stripped by a 301 and persisted as a cookie, as the source said.

### Confirmed live, local dev

Two setup blockers hit first, both worth recording:

1. **Port 5000 collides with macOS AirPlay Receiver.** `ControlCenter` holds `*:5000` and the CLI never passes `--port`, so the handler dies on startup with `System.IO.IOException: Failed to bind to address http://[::]:5000: address already in use.` Reproduced verbatim. Every PS dev on a Mac will hit this. Workaround: `contensis dev requests sandbox http://localhost:3000 --args --port=5001`, or turn off AirPlay Receiver.
2. **`contensis dev requests` cannot fetch its own binary.** `GitHubCliModuleProvider.FindLatestRelease` calls `api.github.com/repos/contensis/request-handler-localdevelopment/releases` **unauthenticated**, and that repo is private, so it 404s and the command dies with "Unable to get releases". There is no token support anywhere in the provider, and `--release` does not help (it fetches the full list first, then filters). This looks like a straightforward bug to raise with Contensis.

Workaround used, which does work: download the release asset with authenticated `gh`, extract it to `~/.contensis/request-handler-localdevelopment-v1.0.1/`, then pre-seed `~/.contensis/cli-manifest.json` with `version: "v1.0.1"`. That makes `downloadImmediately` false, so the failing GitHub call is fired unawaited and no longer blocks startup. Confirmed: the 404 still appears in the log but the handler now launches past it.

**Side effect to be aware of:** `~/.contensis/cli-manifest.json` is now pinned to `v1.0.1` and will no longer auto-update. The original (`version: "*"`) is at `~/.contensis/cli-manifest.json.bak`. Restoring it returns the CLI to the broken-but-default state.

**What the dev server actually receives.** A header-dumping sink on port 3000 behind the local handler, for `GET http://localhost:5001/accessibility`:

```
GET /
x-node-id: b36fcb8a-5817-444e-b3f5-d361ba041ae6
x-entry-id: 5ba49eef-cff1-46b7-9767-1665f19257c2
Host: localhost
traceparent: 00-...
```

That single capture confirms four things at once:

- **The friendly path is lost.** Requested `/accessibility`, delivered `/`. The local debug data shows `enableFullUriRouting: false` even though the deployed block has it **true**, plus `projectUuid: 00000000-0000-0000-0000-000000000000`. Production gives the block `/accessibility`; local dev gives it `/`. This is the endpoint-override gap, now observed rather than inferred, and it is the biggest single obstacle to a faithful local dev loop.
- **No query params**, matching the deployed post-cutoff behaviour.
- **`x-node-id` and `x-entry-id` do arrive**, so the header channel is the one dependable input and it works locally.
- **Nothing else arrives.** No alias, no project, no language, no site type. Sending `x-requires-*` forwards those hint headers to the block but does **not** add the values to the request. So alias, project and language have to come from block config or env, never from the request.

## Local reference

- **The Request Handler source is cloned** at `departments/product-development/svc/contensis-svc-request-handler` (it was already in `repos.tsv`, just never pulled down). The `request-handler-localdevelopment` submodule inside it owns the routing core and is pinned to `main` HEAD with no drift. Use `--recurse-submodules` when re-cloning. Most of the contract reads straight out of these two; prefer reading them over running experiments.
- `contensis-react-base` and `react-starter` are both cloned at `departments/professional-services/react-crb/`, so CRB behaviour (i18n, cache keys, link depth) can be read from source rather than inferred.
- `departments/professional-services/react-crb/.knowledge/` holds the existing PS skill library and is the de facto feature inventory the new framework has to cover.
- Everything worth keeping from the spike-zero and spike-one scratch work has been compiled into this repo. Nothing else depends on that scratch work still existing.

## First step

**Spike zero: done.** Source across all three repos, live captures from the deployed service, a locally run handler, and the real production block image run behind that handler. The contract is documented above and in `.knowledge/contensis-request-handler-contract.md`. Nothing material is left unanswered; endpoint-path routing is unobserved but settled from source.

**Spike one: done.** A minimal Vite app behind the local request handler, built as scratch work and not carried into this repo. No state, no Composer, no styling. The contract it has to satisfy is now known exactly: it is served at `/`, with `x-node-id` and `x-entry-id` as the only inputs, so it should read those headers, fetch the node from the Delivery API, and render from that. Path-based dispatch cannot be reproduced locally, but it does not need to be: the source says exactly what it does, and CRB's behaviour behind the same handler is now a known-good reference. Run the handler with `--args --port=5001` to avoid AirPlay.

**Done: the real block image, run locally.** Pulled
`gitlab.zengenti.com:4567/university-of-leicester/sandbox/main/app:build-3` and ran it
behind the local handler. `docker login gitlab.zengenti.com:4567` with the `glab` token
for `gitlab.zengenti.com` is all the auth it needed. Full findings in
`.knowledge/contensis-request-handler-contract.md`; the three that change our plans:

- **CRB dispatches on the path and nothing else.** It ignores `x-node-id` and
  `x-entry-id` completely, and ignores the pre-cutoff query params too. The header
  channel the handler guarantees is not consumed by the production framework at all.
- **So the local dev loop is already broken for CRB.** `GET /accessibility` through the
  local handler renders the **homepage**, because the handler drops the path and CRB has
  nothing else to route on. This is not a new-framework problem to solve, it is an
  existing upstream gap everyone lives with, and it is worth raising with Contensis. A
  framework that reads the headers and fetches the node would be _more_ correct locally
  than CRB is.
- **The asset contract is fully settled**, and one earlier claim was wrong: the
  `/_{hash}_{blockVersionId}/` rewrite **does** run in local dev. A Vite build needs
  `base: "/static/"` **and** `build.outDir: "dist/static"`; unprefixed `/static/...`
  404s through the handler. Proven end to end with a Dockerised spike one.

Also learned, from `docker image inspect`: a block image exposes `3001/tcp` and its
entrypoint is `node dist/server/launcher.js --alias=$alias --projectId=$projectId
--accessToken=$accessToken`. That is the concrete config channel behind "take alias and
project from env, never from the request".

**Done: spike one is Dockerised** (scratch work, not carried into this repo). A
`Dockerfile` plus an `nginx.conf`, from
https://viteplus.dev/guide/docker but serving under `/static`. Builds and works behind
the local handler. **Not pushed** as a block version; that is a separate decision, and
it is the only way to get the remaining deployed-side data (cache keys, endpoint-path
dispatch, the real hash prefix).

**Done: routing step 1a**, in `packages/routing`. A pure, network-free resolver that turns
the inbound headers into a node or path identity, with the real captures as fixtures. Step
1b (the node fetch) is next, and the remaining steps are listed in
`packages/routing/.knowledge/routing-design.md`.

**The wiring point for the SSR app.** `apps/website` is still the untouched Vite+ starter.
Its `package.json` already declares `"routing": "workspace:*"` but nothing imports it yet,
so that dependency is the seam where the app and the routing package meet when the app
gets built.

**Spike two: an islands proof on top of that route.** A statically rendered page with one hydrated island, to test whether selective hydration holds up against the Contensis packages.

## Open questions

Trimmed after reading the handler source directly. What used to be here as "unobserved" is now answered in `.knowledge/contensis-request-handler-contract.md`: the endpoint-path shape is a two-line branch in `RouteInfoFactory`, the asset prefix is a computable xxHash32, and the cache-key contract is `surrogate-key` response headers. None of it needed a deployment.

What is left is not exploration we can perform. These are questions for Contensis:

- Is the discarded `originPath` return an intended removal or a live bug? Cheapest upstream fix if we want the friendly path passed through.
- What is the intended post-cutoff channel, and why? No design doc for the 2025-11-03 migration was found. Worth pairing with the finding that **CRB does not read the headers at all**, so the migration left the production framework routing on a path that local dev then drops.
- `contensis dev requests` cannot fetch its own binary: `GitHubCliModuleProvider.FindLatestRelease` calls the GitHub API unauthenticated against a private repo. Straightforward bug.
- The preview toolbar reads `entryId` from the query string, which post-cutoff no longer exists, so `window.ContensisEntryId` is likely emitted empty on new blocks. Inferred from source.
- Minor: `traceparent` is on the request denylist yet the local sink received one. Most likely the .NET HttpClient adding its own. Harmless.

## Test environments

- **`prs` / `reactStarter`** is the sandbox for pushing test blocks (Sam, 2026-09-04).
- **`uol` / `universityDemo`** is a live client environment. Read-only: delivery queries, `contensis get block`, and pulling the block image are fine. **Never push a block version there.**

Worth knowing about prs before using it: `react-starter`, `storybook` and `ci-env-blocker` are declared blocks with **zero versions pushed**, and the `react-starter` renderer holds the `*` catch-all. So every content node routes to a block with nothing behind it, which is why the earlier prs captures were all IIS fallback. That was never a capture problem. The site view itself is real (`/en-gb`, `/en-gb/content-page`, `/en-gb/listing-page`), and `/en-gb/storybook-ui` is a live example of a bare non-entry node with a renderer ref. `ui-storybook` is the only block with versions, pulled from `ghcr.io/zengenti/ui/ui-storybook` (`status: "external"`), so ghcr is the proven registry for prs.
