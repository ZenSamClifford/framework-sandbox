# routing

Resolves the Contensis node/entry identity of an inbound request from the headers a
locally run Request Handler puts on it.

```ts
import { resolveIdentity } from "routing";

const resolution = resolveIdentity({ headers, url });
// resolution.identity  -> { kind, value, source }
// resolution.entryId   -> string | undefined
// resolution.diagnostics
```

## Development

Run the unit tests:

```bash
vp test
```

Replay the captured requests through the resolver and print what comes out, so the
behaviour can be eyeballed without reading the test assertions:

```bash
vp run demo
```

The fixture in `src/fixtures/inboundHeaders.capture.log` is a verbatim capture of real
requests. It is concatenated JSON objects rather than a JSON array, and the `.log`
extension is deliberate: see the docstring in `src/fixtures/inboundHeaders.ts`.

## Scope

This package implements **step 1a** of the routing design: turning an inbound request into
a node or path _identity_, purely and with no network access. Turning that identity into a
node (step 1b) is not built.

## Design and decisions

| File                                  | What it covers                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `.knowledge/routing-design.md`        | Why routing goes on node identity rather than the request path, and the build order for the rest |
| `.knowledge/request-path-contract.md` | The routing-relevant slice of the Request Handler contract, distilled                            |
| `.knowledge/resolver-decisions.md`    | Why this resolver behaves as it does, and what a change must not break                           |

The full handler contract and the raw captures behind all of it are at the repository root,
in `.knowledge/contensis-request-handler-contract.md` and `evidence/`.
