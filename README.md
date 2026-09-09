# Framework Sandbox

Currently a Vite+ monorepo. Using this as a place to explore routing and other frameworks specific tooling with use with Contensis CMS.

## Development

- Check everything is ready:

```bash
vp run ready
```

- Run the tests:

```bash
vp run -r test
```

- Build the monorepo:

```bash
vp run -r build
```

- Run the development server:

```bash
vp run dev
```

## Where the learnings are

This repo carries the findings from an earlier throwaway test bench, where the Contensis
Request Handler contract was worked out from source and confirmed against a live
environment. That scratch work was never committed, so the findings, the reasoning and the
raw captures were compiled into this repo to make them durable. Everything below stands on
its own; nothing needs the original scratch repo to make sense.

- `EXPLORATION.md` is the living plan, the spike status and the open questions for Contensis.
- `.knowledge/` holds the Request Handler contract, the Vite+ toolchain notes and the test
  environment rules. Read the contract before writing any request handling or asset code.
- `packages/routing/.knowledge/` holds the routing design and the resolver decisions.
- `evidence/` holds the raw captures every claim rests on.

`AGENTS.md` (symlinked as `CLAUDE.md`) indexes all of it and says when to load what.
