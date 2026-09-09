---
applies_to: the framework-sandbox routing package and the SSR app that consumes it
keywords:
  [
    routing,
    route resolver,
    node id,
    x-node-id,
    entry id,
    contentTypeId,
    content type dispatch,
    canonical url,
    hydration,
    path params,
    partial match,
    404,
    IIS fallback,
  ]
type: design
description: Route on node identity rather than the request path, and the order to build it
---

# Routing design

Recommendation for the new framework's routing, and the order to build it. Every constraint
below is confirmed from handler source or live capture, not assumed. The routing-relevant
constraints are summarised in `request-path-contract.md` alongside this file; the full evidence
is in `../../../.knowledge/contensis-request-handler-contract.md`.

## The one rule

**Route on node identity, not on the request path.**

The path is the least reliable input the block gets. It is `/` under local dev, the
friendly URL when `enableFullUriRouting` is on, and a declared endpoint path otherwise.
`x-node-id` and `x-entry-id` are set unconditionally in all three cases.

CRB routes on the path alone. That is exactly why every page renders as the homepage
under `contensis dev requests` today. Not a gap to work around, a design to not repeat.

## Resolution: one resolver, two transports

`delivery.nodes.get()` accepts either an id or a path and returns the same node, so this
is one function with two ways in, not two code paths.

| Context                       | Input   | Source                |
| ----------------------------- | ------- | --------------------- |
| Server, first request         | node id | `x-node-id` header    |
| Server, pre-cutoff block      | node id | `?nodeId` query param |
| Client, subsequent navigation | path    | `location.pathname`   |

Fallback order server-side: header, then query param, then path. The path is a last
resort, never the primary.

```ts
const node = await delivery.nodes.get({
  id: nodeId,
  entryFields: ["*"],
  entryLinkDepth: 0, // images still resolve via sys.properties
});
```

One call gets the node and its entry. Raise `entryLinkDepth` only where a page needs it.

## Dispatch on `entry.sys.contentTypeId`

The only key stable across all three path shapes, and it mirrors how Contensis renderers
already resolve. CRB's `contentTypeRoutes.ts` is the same idea, so that half of the
migration is a rename rather than a rewrite. CRB's `staticRoutes.ts` is the half that
does not survive: app-defined paths are exactly what the handler does not reliably
deliver.

## `node.path` is the canonical URL

Never `location.pathname` server-side. Canonical tags, `og:url`, breadcrumbs, self-links
and any generated URL come from the node. This is what makes the endpoint-path shape work
without our ever having observed it.

## Hydration: serialise the resolved node id

Serialise the node id the server resolved into the HTML, and have the client hydrate from
**that**, not by re-resolving from the URL. The browser URL and the server's
header-derived node can legitimately disagree: guaranteed under an endpoint path, and
possible whenever an entry has several nodes (`nodes.getByEntry` returns `Node[]`, which
is why `canonicalOnly` exists). Resolving from the path on mount would hydrate against
different content than was rendered.

Resolve from the path only on _navigations_.

Do not use the injected `window.Contensis*` globals for identity. They are in the same
namespace and tempting, but `ContensisEntryId` is likely emitted empty post-cutoff.

## Path parameters, settled from source

`RouteService.GetRouteForRequest` (localdevelopment repo) resolves the **nearest ancestor
node** when no node exists at the exact path, and flags it:

```csharp
var isPartialMatchPath = !node.Path.EqualsCaseInsensitive(originPath);

if (node.RendererRef != null)
    if (!isPartialMatchPath || node.RendererRef.IsPartialMatchRoot)
        rendererRefId = …;

routeInfo = await publishingService.GetRouteInfoForRequest(
    …, node.ContentTypeId, rendererRefId, …);
```

Two consequences, and the asymmetry matters:

- **Content-type routing survives a partial match.** `node.ContentTypeId` is passed
  through unconditionally, never gated on `isPartialMatchPath`. So `/search/facet`
  resolving to a `/search` node still reaches the block.
- **An explicit renderer ref does not,** unless that renderer ref has
  `IsPartialMatchRoot` set on the node. So a `/storybook-ui`-style bare node needs that
  flag before it will serve sub-paths.

So a `/search/:facet` route needs **one** node at `/search`, not a node per facet value.
That was the open question gating this whole class of routes.

The block receives the ancestor node's id (`NodeInfo` is built from `node.Id`,
`node.EntryId`, `node.Path`) together with the full requested path. **The remainder is
therefore `requestPath - node.path`,** computed by the app.

**Caveat that bites:** local dev drops the path, so the remainder is empty there. Path
parameters are the one part of routing that cannot be exercised under
`contensis dev requests`. Treat the remainder as optional and degrade to the node's own
page when it is absent, or path-param routes will look broken locally for the wrong
reason.

## Decide 404 deliberately

A 404 from the block triggers an upstream IIS fallback round-trip that may serve IIS
content in place of our page. Two defensible answers when node resolution fails:

1. **404 with our own body,** accepting the round-trip and the risk of IIS content.
2. **200 with a not-found page,** keeping control of the response.

This is a routing decision, not an nginx default. The Dockerised spike took option 2 by
accident, through a plain SPA `try_files` fallback, which means the app returns 200 for every
path and can never signal "not found": a missing page becomes an empty shell. Whichever answer
we land on should be chosen, not inherited from a server config.

## Free with routing

`RouteService` calls `cacheKeyService.AddRange(node.CacheKeys)`, so node cache keys are
added by the handler without the app doing anything. The app's own contribution is
`surrogate-key` response headers for whatever else it read.

## Build order

1. **The resolver**, split in two so the halves stay independently testable.
   **1a is done**, in this package. Its behaviour is covered by the table test suite in
   `../src/resolveIdentity.test.ts`, which makes no network calls. **1b is next.**
   - **1a, identity extraction.** A pure function, `(headers, query, path) → {kind, value}`.
     No network, no credentials, no Docker. Most of the contract lives here.
   - **1b, node fetch.** `{kind, value} → node + entry` via `nodes.get()`. Needs
     credentials, so keep it behind its own module boundary and 1a's suite runs anywhere.
2. **Content-type dispatch.** A map from `contentTypeId` to page component, plus a
   not-found branch.
3. **Canonical URL helpers** off `node.path`: breadcrumbs, self-links, canonical tag.
4. **Serialised node id + client hydration** from it.
5. **Client-side navigation** resolving by path through the same resolver.
6. **Path remainder handling,** last, and knowing it cannot be tested locally.

Steps 2 to 6 are open. This list is the handover: step 1a is the only one built.

Test 1 to 4 behind the local handler. The headers work there and the path does not, which
makes it a genuinely useful loop and the one place local dev has **higher** fidelity than
CRB's current story.

## Not blocked on the rendering fork

None of this depends on islands vs SSR vs SSG. The resolver and the dispatch table are
the same in all three. Routing can be built now, and the Tier 1 rendering decision can be
taken against a working route rather than in the abstract.

## Step 1 in detail

### 1a: identity extraction

```
(headers, query, path) -> { kind: "id" | "path", value: string }
```

A table test, no network:

| headers         | query       | path             | expect                                       |
| --------------- | ----------- | ---------------- | -------------------------------------------- |
| `x-node-id: A`  |             | `/`              | id `A`                                       |
| `x-node-id: A`  | `?nodeId=B` | `/`              | id `A` (header wins)                         |
|                 | `?nodeId=B` | `/`              | id `B` (pre-cutoff block)                    |
|                 |             | `/accessibility` | path `/accessibility`                        |
|                 |             | `/`              | path `/`                                     |
| `x-node-id: ""` |             | `/about`         | path `/about` (blank is absent, not present) |

The blank-header row is the one that bites. Decide separately what a malformed
`x-node-id` does: the handler strips inbound `nodeId`/`entryId` so spoofing is not the
risk, but a non-GUID should not reach the Delivery API.

Use real fixtures, not hand-written headers. `../src/fixtures/inboundHeaders.capture.log` is a
verbatim capture of actual handler output, cut from
`../../../evidence/captures-uol/inbound-headers.capture.log`.

### 1b: node fetch

Known-good values on `uol` / `universityDemo`:

- id `b36fcb8a-5817-444e-b3f5-d361ba041ae6` → node with `path: "/accessibility"`, entry `contentTypeId: contentPage`
- path `/accessibility` → **the same node**. Both transports converging is the assertion that matters.
- a fresh UUID → the not-found branch, not a throw.

### The acceptance test

The resolver returns the **Accessibility** node when the path arrives as `/`. Same
request, same handler, same dropped path, against the production framework as a
reference:

```bash
docker run -d --name uol-sandbox --platform linux/amd64 -p 3002:3001 \
  -e alias=uol -e projectId=universityDemo \
  gitlab.zengenti.com:4567/university-of-leicester/sandbox/main/app:build-3

# CRB behind the handler
contensis dev requests sandbox http://localhost:3002 --args --port=5001
curl -s localhost:5001/accessibility | grep '<h1>'   # -> "React Starter": the WRONG page

# the resolver behind the handler
contensis dev requests sandbox http://localhost:3003 --args --port=5001
curl -s localhost:5001/accessibility                 # -> the Accessibility node
```

CRB gets it wrong, the resolver gets it right, and the difference is the whole point of
the design.

**Keep step 1 isolated:** the resolver returns the node and stops. No rendering, no
dispatch, no component lookup. For step 1 the "app" is a JSON dump of the resolved node.
That keeps step 1's test surface from entangling with step 2's, and makes the A/B above
readable in a terminal.
