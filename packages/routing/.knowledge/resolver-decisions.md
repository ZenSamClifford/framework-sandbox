---
applies_to: changes to resolveIdentity or to the routing package's test and fixture setup
keywords:
  [
    resolveIdentity,
    diagnostics,
    malformed guid,
    blank header,
    normalisePath,
    trailing slash,
    entryId,
    fixtures,
    capture log,
    no runtime dependencies,
    step 1a,
  ]
type: standard
description: Why the identity resolver behaves the way it does, and the constraints to preserve when extending it
---

# Resolver decisions

The decision log for what is actually built. `routing-design.md` says what to build and
why; this says what was chosen while building it, and what a change must not break. The
code carries the same reasoning inline, in more detail: prefer
`../src/resolveIdentity.ts` when the two disagree, and correct this file.

Scope is **step 1a only**: a pure, network-free `(headers, url) -> Resolution`. Turning
an identity into a node is 1b and is not built.

## Blank is absent, malformed is a diagnostic

Two different failure modes, deliberately handled differently:

- A **blank or whitespace-only** header counts as absent, **silently**. Nothing is
  reported. A warning here would be noise, since it is a normal shape rather than a
  fault.
- A **non-blank value that is not a GUID** is reported as a `Diagnostic`, then treated
  as absent. Reporting it matters because it indicates something genuinely wrong
  upstream; treating it as absent matters because a malformed id must never reach the
  Delivery API.

Both fall through to the path. Neither throws. The blank-header case is the one that
bites, and it has been a table-test row since the design document.

Spoofing is not the risk being defended against: the handler strips inbound
`nodeId` / `entryId` params before injection. The concern is only that garbage should
not be forwarded to a downstream API.

## Header reading is defensive on purpose

Headers are read case-insensitively, and a repeated or array-valued header takes its
first value. Node lowercases header names but not every runtime does, and this package
is meant to work under both a Node server and a Fetch-style runtime.

## `normalisePath` mirrors the handler, not good taste

```ts
pathname.length > 1 ? pathname.replace(/\/+$/, "") || "/" : pathname;
```

This deliberately reproduces the handler's own C# rule from
`RouteService.GetRouteForRequest`:

```csharp
AbsolutePath.Length > 1 ? AbsolutePath.TrimEnd('/') : AbsolutePath
```

There are tidier normalisation rules. Matching theirs matters more than picking a
better one, because a path we normalise differently from the handler is a path that
resolves to a different node. If the handler's rule changes, change this to match
rather than improving on it.

## `entryId` is supplementary and never the dispatch key

It is returned when present, and it is useful for preview state and as a
`nodes.getByEntry` fallback in 1b. Dispatch is on the node, then on
`entry.sys.contentTypeId`. An entry can have several nodes, which is why
`nodes.getByEntry` returns `Node[]` and why `canonicalOnly` exists, so an entry id
cannot identify a page on its own.

## The fixture is a `.log` on purpose

`../src/fixtures/inboundHeaders.capture.log` is a verbatim capture of three real
requests from behind a locally run handler. It is **concatenated JSON objects, not a
JSON array**, because that is what the header sink emitted and the value of a fixture
is that it is unedited.

Naming it `.json` would make every formatter and parser choke on a file that is
genuinely not a JSON document, and `vp check --fix` runs over staged files via the
pre-commit hook, so it would break commits rather than merely look wrong.
`splitConcatenatedJson` in `../src/fixtures/inboundHeaders.ts` is a brace-depth scanner
that reads it. The package `.gitignore` un-ignores `!src/fixtures/*.capture.log`. The
same convention is used in `../../../evidence/`.

## `IDENTITY_HEADERS` is a record, consumed at the call sites

The two header names the resolver reads are exported so a consumer can display or forward
them without restating the list. It is a record rather than a bare array, and
`resolveIdentity` reads `IDENTITY_HEADERS.nodeId` / `.entryId` instead of its own string
literals, so the constant cannot drift from the behaviour. A constant the resolver does
not itself use is a constant that goes stale, and no test can protect against that as
cheaply as using it can.

What deliberately did **not** come with it: the handler's request denylist, and the
`x-requires-*` hint names. Both are facts about the handler, not about this resolver, and
the resolver does not act on either. A consumer that wants to display them can hold its
own list, which is what `apps/website/server/panel.ts` does. Keeping handler trivia out of
a pure resolver is the same instinct as keeping the network out of it.

That distinction earned itself quickly. The panel's denylist was wrong in three places
when checked against a deployed block, and correcting it touched nothing in this package.

## Keep the package dependency-free

There are **no runtime dependencies**, and step 1a makes no network calls, needs no
credentials and needs no Docker. That is why its suite runs anywhere, including in CI
with no Contensis access.

When 1b lands, keep the node fetch behind its own module boundary so this property
survives. It is the reason the resolver was split in two in the first place.
