# Repository: framework-sandbox

A Vite+ monorepo used to work out how a Contensis block should receive a request and turn
it into a page, ahead of building a routing package and a React SSR app on top. The
findings from the earlier exploratory work are compiled here, in `.knowledge/`,
`EXPLORATION.md` and `evidence/`.

This repo is **exploratory**. There is no released framework and no client projects on it.
Treat guidance here as findings in progress rather than settled convention, and prefer
`react-crb` for any current client work.

## Inheritance

This file is applied after ancestor `AGENTS.md` files. Supplementary detail is in
`.knowledge/` at this level and at ancestor levels. Load knowledge files by scanning their
frontmatter, and do not load files whose `applies_to` and `keywords` do not match the
current task.

`CLAUDE.md` is a **symlink** to this file, so the two can never drift. Do not replace it
with a copy.

## Knowledge

This level has a `.knowledge/` folder. Scan the frontmatter before starting work and load
only what matches.

| File                                               | Load when                                                                                                                                                                                                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.knowledge/contensis-request-handler-contract.md` | Working on how a block receives requests: node and entry ids, path resolution, static asset paths, preview state, cache keys, or running a Request Handler locally. This is the authoritative document and the binding constraint on almost everything else. |
| `.knowledge/vite-plus-toolchain.md`                | Scaffolding a package, changing build or lint config, writing a Dockerfile, or debugging `vp` behaviour                                                                                                                                                      |
| `.knowledge/contensis-block-runtime.md`            | Writing or changing the server inside a block: staying up, serving the build, choosing 404s, the per-version asset prefix, or verifying a deployed block.                                                                                                    |
| `.knowledge/contensis-block-ci.md`                 | Building, publishing or pushing a block from CI, or debugging a failing `push block`. Includes the commit-message shell injection in `contensis/block-push` that will break the push.                                                                        |
| `.knowledge/contensis-test-environments.md`        | Running anything against a live Contensis environment, picking fixture ids, or getting a local Request Handler to start                                                                                                                                      |
| `packages/routing/.knowledge/`                     | **Any routing work.** Three files there cover the design and build order, the routing-relevant slice of the handler contract, and the decisions baked into the resolver. Read those instead of the full contract.                                            |

A **package-level** `.knowledge/` folder is a local extension of the convention, which
elsewhere in the tree exists only at repository level and above. It is deliberate: the
routing material is the part most likely to travel with the package if it is extracted,
so it lives next to the code it describes.

`EXPLORATION.md` at the root is the living plan and the open questions for Contensis. It
is a document for a person to read, not reference material to load per task.

`evidence/` holds the raw captures every claim in `.knowledge/` rests on.

When a developer asks to add a rule or add knowledge, use the relevant skill in
`departments/skills/`. This repo is a leaf with its own `.git`, so changes here are direct
edits with no branch or PR against the parent context repository.

## Working at This Level

A pnpm workspace (`apps/*`, `packages/*`, `tools/*`; `tools/` does not exist yet), driven
by the Vite+ `vp` CLI rather than by pnpm directly.

- `packages/routing` is the core of the work in the repo. It implements **step 1a** of the
  routing design: a pure, network-free resolver from request headers to a node or path
  identity. No network calls, no runtime dependencies, no credentials needed to test it.
  Step 1b (the node fetch) and everything after it are not built.
- `packages/utils` is an untouched library scaffold from the starter.
- `apps/website` is the Vite+ vanilla-TS starter, deployed as a Contensis block. It
  builds with `base: "/static/"`, and `server/index.ts` (a `node:http` server) mounts
  `dist` at `/static` and serves the shell for everything else.
  `docker/website.Dockerfile` and `.github/workflows/website-block.yml` build it and push
  it to `prs` / `tim`. The server calls `resolveIdentity` from `packages/routing` on every
  page request and `server/panel.ts` renders the result, plus every routing-relevant
  header, env value and manifest field, into the page below the starter content. Absent
  values get a visible row on purpose: the local-versus-deployed divergence is the thing
  being verified. The same data is embedded as a one-line
  `<script id="routing-panel-data" type="application/json">` block, so a deployed check is
  `curl | jq` rather than eyeballing. `src/routingPanel.ts` fills in the `window.Contensis*`
  section, which only a handler-served page has.
- The website image is no longer dependency-free. Node refuses to strip types from any
  file under a real `node_modules` path, so the runtime stage ships the packed
  `packages/routing` output plus the shim manifest in
  `docker/routing-runtime-package.json` rather than the source. It is a copied dependency
  rather than a bundled server so `CMD` still runs the file you can read in the repo.

## Guidance

- **The Request Handler contract is the binding constraint.** Read
  `.knowledge/contensis-request-handler-contract.md` before writing any request handling,
  routing or asset code. Most "obvious" designs fail against it.
- **Do not derive routing from the URL path.** The path is `/` in local dev, the friendly
  URL under `enableFullUriRouting`, and an endpoint path otherwise. Route on the node
  identity in `x-node-id`. This is the single most important finding in the repo, and
  routing on the path is precisely why CRB renders the homepage for every page behind
  `contensis dev requests`.
- **Alias, project and language come from block config or environment variables, never
  from the request.** A 22-entry header denylist means they cannot arrive on it.
- **Local dev diverges from production**, most importantly by dropping the path. A
  path-based design passes locally and fails deployed, so verify against a real block
  rather than trusting a green local run.
- **`uol` / `universityDemo` is a live client environment. Never push a block version to
  it.** `prs` / `reactStarter` is the push sandbox. See
  `.knowledge/contensis-test-environments.md`.
- **Do not tidy the `.capture.log` files** in `evidence/` or in
  `packages/routing/src/fixtures/`. They are deliberately not JSON documents, and renaming
  them to `.json` breaks `vp check` on commit.
- When a knowledge file here disagrees with the code, say so before closing your response
  rather than silently following either one. The code comments in
  `packages/routing/src/` are the more detailed record.

<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->
