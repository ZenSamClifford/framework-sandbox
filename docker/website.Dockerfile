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
# `vp build`, not `vp run build`: the script prefixes tsc, which belongs in CI.
WORKDIR /app/apps/website
RUN vp build

# Export the exact Node.js resolved from .node-version for the runtime stage.
RUN cp "$(vp env which node | head -1)" /tmp/node

# --- runtime stage: small, glibc, no vp ---
# No deps stage: the server is node: builtins only, so the image needs no
# node_modules at all. That ends when packages/routing is wired into the server.
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

USER nobody
EXPOSE 3001
# Node >= 22.18 strips TypeScript natively, so the server needs no build step.
CMD ["node", "server/index.ts"]
