import { defineConfig } from "vite-plus";

export default defineConfig({
  // The Request Handler only resolves assets whose emitted URLs literally contain a
  // declared static path, and rewrites those literals to
  // /_{hash}_{blockVersionId}/static/... on the way out. Anything emitted outside a
  // static path is treated as a friendly URL, finds no node, and 404s.
  //
  // The files still have to exist at the path being requested. Here the server mounts
  // dist at /static rather than the build writing to dist/static, which is the
  // alternative the handler contract sanctions.
  base: "/static/",
  server: { port: 3000, strictPort: true },
});
