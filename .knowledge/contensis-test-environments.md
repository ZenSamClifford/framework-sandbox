---
applies_to: any work in this repo that touches a live Contensis environment or runs a Request Handler locally
keywords:
  [
    test environment,
    uol,
    universityDemo,
    prs,
    reactStarter,
    tim,
    sandbox block,
    contensis dev requests,
    airplay,
    port 5000,
    cli manifest,
    fixture ids,
    read-only,
  ]
type: standard
description: Which Contensis environments are safe to push to, the known-good fixture ids, and the two blockers that stop a handler starting locally
---

# Contensis test environments

Two environments are in play, and they are not interchangeable. Getting this wrong
touches a live client environment, so read this before running anything that writes.

## `uol` / `universityDemo` is a live client environment

**Read-only. Never push a block version there.**

Allowed: delivery queries, `contensis get block`, `contensis get renderer`, pulling
the block image, and running that image locally behind a handler. All of the captures
in `../evidence/` were taken this way.

- CMS: https://cms-uol.cloud.contensis.com/app/projects/universityDemo/blocks/sandbox
- Alias `uol`, project `universityDemo`, block `sandbox`
- Staging: `https://staging-universitydemo-uol.cloud.contensis.com?block-sandbox-versionno=3`
- The `sandbox` renderer is assigned to content type `contentPage`; `university-demo`
  is the catch-all (`*`). So any `contentPage` node routes to `sandbox`. There are at
  least 92 such nodes within three levels of the root.
- `sandbox` v3 was pushed **2026-08-13**, comfortably after the `2025-11-03` query
  param cutoff, which is what makes it a real test of post-cutoff behaviour.

## `prs` / `reactStarter` is the push sandbox

This is where a test block version goes (Sam, 2026-09-04).

Worth knowing before using it: `react-starter`, `storybook` and `ci-env-blocker` are
declared blocks with **zero versions pushed**, and the `react-starter` renderer holds
the `*` catch-all. So every content node routes to a block with nothing behind it,
which is why the early `prs` captures were all IIS fallback. That was never a capture
problem, and it is recorded in `../evidence/prs-capture-notes.txt`.

The site view itself is real (`/en-gb`, `/en-gb/content-page`, `/en-gb/listing-page`),
and `/en-gb/storybook-ui` is a live example of a bare non-entry node with a renderer
ref. `ui-storybook` is the only block with versions, pulled from
`ghcr.io/zengenti/ui/ui-storybook` (`status: "external"`), so ghcr is the proven
registry for prs.

## `prs` / `tim` is where this repo's own block goes

`tim` is a second project on the same `prs` alias, and it is where `apps/website` is
pushed from CI (`.github/workflows/website-block.yml`). It was empty before the first
push; a `website` renderer now holds the `*` catch-all, and it appeared with the push
rather than being created by hand.

Live and verified, **current as of 2026-09-10**. The version number moves with every push
to `main`, so read it rather than trusting a number written here:

```bash
contensis get block website main --format json     # every version and its status
```

- Staging, substituting the version you want to pin:
  `https://staging-tim-prs.cloud.contensis.com/?block-website-versionno=<n>`
- At the time of writing the latest was **v6**. Earlier versions stay registered and
  `deprecated` rather than being removed, so the list only grows.
- Fetch with a cookie jar (`curl -L -c jar -b jar`): the version pin is stripped by a 301
  and persisted as a cookie, so without it you land unversioned with an empty body.
- The site view has a `/` node (`en-gb`, Home) and a `/blogs` subtree, so the catch-all
  reaches the block on more than one node. Known-good ids for fixtures:
  `/` is node `97ad4a16-821a-4798-adcd-f17ce876538a`, and `/blogs/canvas` is node
  `c877264a-787f-4b0d-8045-1ec8ee2d3d4e` with entry `ebec630b-67ef-4ccb-ae5d-11679f4719eb`.
  Not every `/blogs/*` path resolves: several return the platform's 404 and never reach
  the block.
- Captures in `../evidence/captures-prs/`, including the routing panel captured both
  deployed and behind a local handler, which is the cheapest way to re-check the header
  contract on any version.

Pushing here is safe for the same reason `reactStarter` is: `prs` is a sandbox alias,
not a client environment.

## Known-good fixture ids

On `uol` / `universityDemo`, used throughout the routing tests:

- Node `b36fcb8a-5817-444e-b3f5-d361ba041ae6` resolves to `path: "/accessibility"`
- Its entry is `5ba49eef-cff1-46b7-9767-1665f19257c2`, `contentTypeId: contentPage`
- Path `/accessibility` resolves to **the same node**. Both transports converging is
  the assertion that matters.
- A fresh UUID should reach the not-found branch rather than throwing.

## Two blockers that stop a handler starting locally

Both were hit on first run and both will hit every PS developer on a Mac.

**1. Port 5000 collides with macOS AirPlay Receiver.** `ControlCenter` holds `*:5000`
and the CLI never passes `--port`, so the handler dies on startup with
`System.IO.IOException: Failed to bind to address http://[::]:5000: address already in use.`
Captured in `../evidence/devrequests-port5000.capture.log`.

A run on 2026-09-10 passed `--port=5001` from the outset and never attempted 5000, so that
run **neither reconfirmed nor refuted** this. Treat it as true until someone tries the
default again; the original capture stands.

Workaround:

```bash
contensis dev requests sandbox http://localhost:3000 --args --port=5001
```

or turn off AirPlay Receiver.

**2. `contensis dev requests` cannot fetch its own binary.**
`GitHubCliModuleProvider.FindLatestRelease` calls
`api.github.com/repos/contensis/request-handler-localdevelopment/releases`
**unauthenticated**, and that repo is private, so it 404s and the command dies with
"Unable to get releases". There is no token support anywhere in the provider, and
`--release` does not help since it fetches the full list first and then filters.
Captured in `../evidence/devrequests-github404.capture.log`. This is a straightforward
bug to raise with Contensis; see the open questions in `../EXPLORATION.md`.

Workaround that does work: download the release asset with an authenticated `gh`,
extract it to `~/.contensis/request-handler-localdevelopment-v1.0.1/`, then pre-seed
`~/.contensis/cli-manifest.json` with `version: "v1.0.1"`. That makes
`downloadImmediately` false, so the failing GitHub call is fired unawaited and no
longer blocks startup. The 404 still appears in the log but the handler launches past
it.

**Side effect to be aware of:** `~/.contensis/cli-manifest.json` is now pinned to
`v1.0.1` and will no longer auto-update. The original (`version: "*"`) is at
`~/.contensis/cli-manifest.json.bak`. Restoring it returns the CLI to the
broken-but-default state.

## Running the handler against this repo's block

The block server listens on 3001, so point the handler there rather than at the `vp dev`
server on 3000. Verified working 2026-09-10:

```bash
cd apps/website && vp run build          # dist must exist; the server does not build it
node apps/website/server/index.ts        # block server, 0.0.0.0:3001

contensis connect prs && contensis set project tim
contensis dev requests website http://localhost:3001 --args --port=5001

curl -sS http://localhost:5001/blogs/canvas \
  | sed -n 's/.*<script id="routing-panel-data" type="application\/json">\(.*\)<\/script>.*/\1/p' | jq .
```

The panel in `apps/website` reports what the block actually received, which is the only
local evidence that node resolution ran at all: **the handler logs nothing about node or
renderer resolution**, only HTTP proxy traces.

## Local dev is real, but it diverges

Node and renderer resolution in local dev hit the live CMS over HTTPS rather than
being stubbed, so fidelity is higher than you might assume. Four confirmed
divergences matter, the first most of all: **the friendly path is lost**, so a request
for `/accessibility` arrives at the block as `/`. Full detail in
`contensis-request-handler-contract.md`.

Two things measured 2026-09-10 that are worth knowing before you plan local work:

- **Identity routing is faithful.** `x-node-id` and `x-entry-id` are set locally, and the
  node ids matched both the CMS and the deployed block for the same two paths. So an app
  that routes on identity behaves the same locally and deployed, which is the whole reason
  the resolver reads headers rather than the path.
- **Almost nothing else arrives.** Of the fifteen request headers a deployed block
  receives, only `traceparent` also arrives locally. No `x-orig-host`, no
  `x-node-versionstatus` or `x-entry-versionstatus`, no `x-alias`. Anything depending on
  those needs an environment fallback locally and a deployed check before you trust it.
  Comparison in `../evidence/captures-prs/routing-panel-local-handler.capture.log`.
