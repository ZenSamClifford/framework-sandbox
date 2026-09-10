# syntax=docker/dockerfile:1
#
# A Contensis block is a container that listens on a port. Build context is the repo
# root, since the app is a workspace member and pnpm needs the workspace manifests.

# --- build stage: the official Vite+ toolchain image ---
FROM ghcr.io/voidzero-dev/vite-plus:latest AS build
WORKDIR /app

# Install first so the layer caches across source changes. pnpm-workspace.yaml is
# mandatory, not just for the member globs: it carries the catalog alias
# vite -> @voidzero-dev/vite-plus-core, and without it the install silently resolves
# upstream Vite instead.
COPY --chown=vp:vp package.json pnpm-lock.yaml pnpm-workspace.yaml .node-version* ./
COPY --chown=vp:vp apps/website/package.json ./apps/website/
COPY --chown=vp:vp packages/routing/package.json ./packages/routing/
COPY --chown=vp:vp packages/utils/package.json ./packages/utils/
RUN vp install --frozen-lockfile

COPY --chown=vp:vp . .

# The server imports `routing`, so the runtime stage needs it as JavaScript. Native TS
# stripping refuses any file under a real node_modules directory; pnpm's symlink is what
# lets the import work locally, because Node resolves the realpath out to
# packages/routing and so never sees the source as a dependency. That cannot be
# recreated in the image, so pack the package and ship the output instead.
# .dockerignore excludes **/dist, so this has to be built here rather than copied in.
WORKDIR /app/packages/routing
RUN vp pack

# `vp build`, not `vp run build`: the script prefixes tsc, which belongs in CI.
WORKDIR /app/apps/website
RUN vp build

# Export the exact Node.js resolved from .node-version for the runtime stage.
RUN cp "$(vp env which node | head -1)" /tmp/node

# --- runtime stage: small, glibc, no vp ---
# One dependency now, not none: server/index.ts imports `routing`. It arrives as the
# packed ESM output rather than as source, for the type-stripping reason above, and as a
# copied dependency rather than a bundled server so that CMD still runs the file you can
# read in the repo. See docker/routing-runtime-package.json.
FROM debian:bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /tmp/node /usr/local/bin/node

COPY --from=build /app/apps/website/dist ./dist
COPY --from=build /app/apps/website/server ./server
# Confirmed against the deployed CRB block image: the manifest sits at the image root
# and nowhere else, even though that image's WORKDIR is /usr/src/app. So the root is
# the location, and WORKDIR-relative is ruled out.
# evidence/captures-uol/block-manifest.capture.log
COPY --from=build /app/apps/website/manifest.json /manifest.json

# The one runtime dependency. The shim manifest mirrors publishConfig.exports, which npm
# would apply on publish but which nothing applies here.
# The whole dist directory, not just index.mjs: `vp pack` emits one JS file today, but a
# second chunk would still build clean here and then kill the container at startup on a
# missing relative import, after CI had already registered the block version.
COPY --from=build /app/packages/routing/dist ./node_modules/routing/dist
COPY docker/routing-runtime-package.json ./node_modules/routing/package.json

USER nobody
EXPOSE 3001
# Node >= 22.18 strips TypeScript natively, so the server needs no build step.
CMD ["node", "server/index.ts"]
