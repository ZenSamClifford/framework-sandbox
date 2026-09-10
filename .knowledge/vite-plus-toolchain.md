---
applies_to: the framework-sandbox monorepo and any Vite+ project built from it
keywords:
  [
    vite+,
    vp,
    vp create,
    vp check,
    vp build,
    vp test,
    oxlint,
    rolldown,
    catalog,
    pnpm workspace,
    docker,
    ports,
    toolchain,
  ]
type: standard
description: Vite+ toolchain behaviour and the gotchas that cost time, learned scaffolding the first spike
---

# Vite+ toolchain notes

Learned scaffolding the first spike on 2026-09-04 with `vp` v0.2.8, then Dockerising
it. The general `vp` reference is in `node_modules/vite-plus/docs` and at
https://viteplus.dev/guide/; what follows is only the parts that surprised us.

Vite+ is a toolchain, not a rendering model. It replaces the tool-wiring layer (Vite,
Vitest, ESLint, Prettier, tsup) with one CLI. It says nothing about the islands vs SSR
fork in `../EXPLORATION.md`, which is still the blocking decision. A working
`vp create` is not progress on that.

## Scaffolding a project

```bash
vp create vite:application --directory <name> --no-interactive \
  --no-git --no-hooks --no-agent --no-editor \
  --package-manager pnpm -- --template react-ts
```

- **`vite:application` silently picks vanilla-TS under `--no-interactive`.** It
  delegates to `create-vite`, and the `-- --template react-ts` pass-through is the
  only thing that makes it React. Omit it and you get a vanilla project with no
  warning.
- **`--hooks` is the default in non-interactive mode.** Left on, it installs a git
  hook dispatcher against the nearest `.git`, which inside the departments tree is
  the shared parent repo rather than the project. `--no-hooks` and `--no-git` are
  deliberate when scaffolding inside an existing tree.
- `--no-agent` / `--no-editor` are skipped on purpose: agent context here comes from
  the context tree and `departments/skills/`, not from generated rule files.

`vp --version` reporting a local `vite-plus` alongside the global CLI, rather than
"Not found", is the signal the local package is wired in.

## Gotchas

**`vp build` is not the `build` script.** A generated `package.json` has
`"build": "tsc -b && vp build"`. The built-in `vp build` skips the `tsc -b` step and
prints a note saying so. Use `vp run build` for the script with the type check, and
`vp build` for the bundle alone. The same distinction applies to `vp dev`.

**`vp test` exits 1 on an empty project.** "No test files found" is Vitest's default
behaviour, not a broken install.

**`vite` is an alias, not the real package.** `pnpm-workspace.yaml` catalogs
`vite: npm:@voidzero-dev/vite-plus-core@0.2.8` and adds a global `overrides` entry
plus `peerDependencyRules.allowAny`. Anything importing `vite` gets the Vite+ core
build. Config files import from `vite-plus` directly. This matters in Docker (below)
and when reading a lockfile.

**A missing `.gitignore` lets `vp check --fix` reformat `node_modules`.** Vite+ takes
its lint and format ignore list from `.gitignore`. A package without one walks
`node_modules`: `vp check` reported 9388 errors and 61647 warnings across 7895 files,
and `--fix` then reformatted vite-plus's own `dist`, after which `vp check` died with
`SyntaxError: Detected cycle while resolving name 'configDefaults' in 'vite-plus'`.
The fix is a `.gitignore` containing `node_modules` plus a clean reinstall. This only
bites when scaffolding a package by hand, since `vp create` writes one.

**Type-aware linting is on by default.** The generated config sets
`lint.options.typeAware` and `typeCheck` true, so `vp check` does the type check via
oxlint-tsgolint rather than a separate `tsc` pass.

**Formatting runs on commit.** The root `vite.config.ts` wires
`staged: { "*": "vp check --fix" }` and `.vite-hooks/pre-commit` runs `vp staged`. A
file with a misleading extension (a `.json` file that is not a JSON document) breaks
the commit rather than merely looking untidy. See `../evidence/README.md`.

## Asset paths are a handler constraint, not a Vite one

A build served behind the Request Handler needs **both**:

```ts
base: "/static/",
build: { outDir: "dist/static" },
```

`base` alone is never sufficient: the files have to exist at the path being requested.
`apps/website` takes the other option the contract allows, keeping the default `outDir`
and letting `server/index.ts` mount `dist` at `/static`. That is the variant verified on a
deployed block; both work. The reasoning, the evidence and the prefix-rewrite
mechanics are in `contensis-request-handler-contract.md`; do not restate them here.

## Docker

Adapted from https://viteplus.dev/guide/docker. The guide's SPA recipe serves `dist`
at `/`, which does not work behind the handler, so ours serves the build under
`/static`.

- **Copy `pnpm-workspace.yaml` into the build stage.** It carries the catalog entry
  aliasing `vite` to `@voidzero-dev/vite-plus-core`. Omit it and the build silently
  resolves upstream Vite instead of Vite+, with no error.
- **`COPY --chown=vp:vp`**, since the image runs as the non-root `vp` user.
- Use `vp build`, not `vp run build`. The package script prefixes `tsc -b`, which
  belongs in CI rather than in the image build.
- **Copy every workspace member's `package.json`** before `vp install`, so the install
  layer caches independently of source changes.
- `vp build` must run from the app directory, not the workspace root. Set
  `WORKDIR /app/apps/website` before it, and copy from that path in the runtime stage.
- **`manifest.json` is easy to lose** in a multi-stage build that only copies `dist`.
  The runtime stage has to copy it explicitly, and it fails silently rather than loudly:
  the defaults (port 3001, `/static`) match, so the block still serves and only
  `enableFullUriRouting` is lost.
- Anything the runtime stage copies must **not** be in `.dockerignore`, or the `COPY`
  fails with "not found" even though the file is plainly there. `**/dist` is safe to
  ignore only because the image builds `dist` itself.
- `docker/website.Dockerfile` is the worked example. It has no `deps` stage at all,
  because its server is `node:` builtins only; that ends the moment `packages/routing`
  is imported into it.

## Ports

Three numbers, none of them shared:

- **Dev server**: pin `server.port` with `strictPort: true` so the handler target is
  stable across runs rather than drifting. `apps/website` uses 3000, deliberately not
  the block's declared 3001, so the dev server and a locally run block image do not
  collide. This is unrelated to the block's declared port; pick any free one, just pin it.
- **Block-declared port** (3001 on the `sandbox` block): what the deployed container
  listens on inside the block runtime. Nothing connects it to the dev server port.
  Map it to a different host port when both run.
- **Local Request Handler**: `--args --port=5001`. Port 5000 is held by macOS AirPlay
  Receiver and the CLI never passes `--port`. See
  `contensis-test-environments.md`.

Vite's own default 5173 is not used anywhere here.
