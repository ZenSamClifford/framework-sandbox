import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    dts: {
      tsgo: true,
    },
    // devExports points every export condition at src during local development,
    // and moves the dist paths into publishConfig. Without it, apps consuming
    // this package cannot resolve it until `vp pack` has run, and then serve
    // stale dist output on every source edit.
    exports: {
      devExports: true,
    },
  },
});
