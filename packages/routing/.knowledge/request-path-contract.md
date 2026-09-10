---
applies_to: routing changes in this package and in any app that dispatches on a Contensis node
keywords:
  [
    x-node-id,
    x-entry-id,
    request handler,
    enableFullUriRouting,
    endpoint path,
    friendly url,
    partial match,
    IsPartialMatchRoot,
    header denylist,
    IIS fallback,
    404,
    local dev divergence,
  ]
type: standard
description: The routing-relevant slice of the Request Handler contract, so a routing change does not need the whole document
---

# What routing can rely on from the Request Handler

A distillation. Each constraint below is stated with just enough detail to design
against; the evidence, the source citations and the confirmed-versus-inferred markings
live in `../../../.knowledge/contensis-request-handler-contract.md`. Read that when you
need to check a claim, and update it rather than this file when a claim changes.

## The headers are the durable channel

`x-node-id` and `x-entry-id` are set on every request, unconditionally, in every path
shape. They are the only reliable identity input a block gets. The resolver exports the
two names as `IDENTITY_HEADERS`, so a consumer displaying or forwarding them does not
restate the list.

**Confirmed on a deployed block, 2026-09-10.** `x-node-id` matched the handler's own
`nodeInfo.id` on two different nodes on `prs` / `tim` v4, with the path arriving as the
friendly URL rather than the `/` local dev gives. That is this document's central claim
checked from both sides rather than from source alone:
`../../../evidence/captures-prs/routing-panel-deployed.capture.log`.

`?nodeId` and `?entryId` are legacy. `RouteInfoFactory.cs` carries a hardcoded cutoff
of `2025-11-03 09:00`, after which both are explicitly nulled out and never appended to
the query string. A block pushed today receives no injected query params at all.

Inbound `nodeId` / `entryId` params are stripped before injection, so a client cannot
spoof them, and they are stripped back out of the `Location` header on a 3xx.

## The path has three shapes, so it cannot be the primary input

| Situation                               | What the block receives                 |
| --------------------------------------- | --------------------------------------- |
| Local dev via `contensis dev requests`  | `/`, always. The path is dropped.       |
| Deployed with `enableFullUriRouting` on | The friendly URL, e.g. `/accessibility` |
| Deployed with a declared endpoint       | The endpoint path, e.g. `/generic-page` |

This is the whole argument for `routing-design.md`'s one rule. A framework that
dispatches on the path passes locally by accident and diverges once deployed, which is
exactly what happens to CRB today.

An `originPath` param is written in code but its return value is discarded
(`QueryString` is a readonly struct), so the friendly path is never delivered as a
query param.

## Partial path matching, and the asymmetry that bites

`RouteService.GetRouteForRequest` resolves the **nearest ancestor node** when no node
exists at the exact path, and flags it as a partial match.

- **Content-type routing survives a partial match.** `node.ContentTypeId` is passed
  through unconditionally. So `/search/facet` resolving to a `/search` node still
  reaches the block.
- **An explicit renderer ref does not,** unless that renderer ref has
  `IsPartialMatchRoot` set on the node.

So a `/search/:facet` route needs **one** node at `/search`, not a node per facet
value. The block gets the ancestor node's id together with the full requested path, so
the remainder is `requestPath - node.path`, computed by the app.

**Caveat:** local dev drops the path, so the remainder is always empty there. Path
parameters are the one part of routing that cannot be exercised under
`contensis dev requests`. Treat the remainder as optional and degrade to the node's own
page when absent, or path-param routes will look broken locally for the wrong reason.

## Nothing else arrives on the request

A 22-entry request header denylist means alias, project api id, entry language and site
type can **never** be read from the request. They come from block config or environment
variables, whose concrete channel is the block image entrypoint:

```
node dist/server/launcher.js --alias=$alias --projectId=$projectId --accessToken=$accessToken
```

The `x-requires-*` headers are a request for **response** headers, consumed by the
cache and CDN layer. Sending them does not add the values to the request. Confirmed
live: the sink received only `x-node-id`, `x-entry-id`, `Host` and `traceparent`.

Preview state comes from the injected `window.Contensis*` globals, not from headers.
Do not use those globals for identity: `ContensisEntryId` is likely emitted empty
post-cutoff.

## A 404 is not free

A 404 from the block triggers an upstream IIS fallback round trip that may serve IIS
content in place of our page.

**But the app is rarely the one deciding.** A path with no node never reaches the block:
the handler resolves, finds nothing, and the request goes to IIS and then to a cached 404
page without the block being involved. Confirmed on a deployed block,
`evidence/captures-prs/block-404-routing.capture.log`. So do not serve a 200 shell to
avoid a 404, which only produces a soft 404; see `routing-design.md`, corrected.

`/favicon.ico` is the only path special-cased to skip node lookup. `robots.txt` and
`ads.txt` resolve only via a site view node, a declared static path, or a separate
block.

## Free with routing

`RouteService` calls `cacheKeyService.AddRange(node.CacheKeys)`, so node cache keys are
added by the handler without the app doing anything. The app's own contribution is
`surrogate-key` response headers for whatever else it read. Local dev binds
`NullCacheKeyService` and emits none.
