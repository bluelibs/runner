import { defineConfig } from "tsup";

const ENTRY = { index: "src/index.ts" } as const;
const EXTERNAL = ["async_hooks", "node:async_hooks"] as const;

function withCommon(overrides: any = {}) {
  return {
    entry: ENTRY,
    splitting: false,
    sourcemap: true,
    treeshake: true,
    minify: false,
    tsconfig: "tsconfig.build.json",
    external: [...EXTERNAL],
    ...overrides,
  } as const;
}

export default defineConfig([
  // Universal (fallback)
  withCommon({
    outDir: "dist/universal",
    platform: "neutral",
    format: ["esm", "cjs"],
    clean: true,
    dts: false,
    esbuildOptions(options) {
      options.metafile = true;
      options.define = {
        ...(options.define || {}),
        __TARGET__: JSON.stringify("universal"),
      };
      options.keepNames = true;
      options.minifyIdentifiers = false;
    },
    outExtension() {
      return { js: ".mjs" } as any;
    },
  }),
  withCommon({
    outDir: "dist/universal",
    platform: "neutral",
    format: ["cjs"],
    clean: false,
    dts: false,
    esbuildOptions(options) {
      options.metafile = true;
      options.define = {
        ...(options.define || {}),
        __TARGET__: JSON.stringify("universal"),
      };
      options.keepNames = true;
      options.minifyIdentifiers = false;
    },
    outExtension() {
      return { js: ".cjs" } as any;
    },
  }),
  // Node
  withCommon({
    outDir: "dist/node",
    platform: "node",
    format: ["esm"],
    dts: false,
    clean: false,
    esbuildOptions(options) {
      options.metafile = true;
      options.define = {
        ...(options.define || {}),
        __TARGET__: JSON.stringify("node"),
      };
      options.keepNames = true;
      options.minifyIdentifiers = false;
    },
    outExtension() {
      return { js: ".mjs" } as any;
    },
  }),
  withCommon({
    outDir: "dist/node",
    platform: "node",
    format: ["cjs"],
    dts: false,
    clean: false,
    esbuildOptions(options) {
      options.metafile = true;
      options.define = {
        ...(options.define || {}),
        __TARGET__: JSON.stringify("node"),
      };
      options.keepNames = true;
      options.minifyIdentifiers = false;
    },
    outExtension() {
      return { js: ".cjs" } as any;
    },
  }),
  // Browser
  withCommon({
    outDir: "dist/browser",
    platform: "browser",
    format: ["esm"],
    dts: false,
    clean: false,
    esbuildOptions(options) {
      options.metafile = true;
      options.define = {
        ...(options.define || {}),
        __TARGET__: JSON.stringify("browser"),
      };
      options.keepNames = true;
      options.minifyIdentifiers = false;
    },
    outExtension() {
      return { js: ".mjs" } as any;
    },
  }),
  // Edge (workers)
  withCommon({
    outDir: "dist/edge",
    platform: "neutral",
    format: ["esm"],
    dts: false,
    clean: false,
    esbuildOptions(options) {
      options.metafile = true;
      options.define = {
        ...(options.define || {}),
        __TARGET__: JSON.stringify("edge"),
      };
      options.keepNames = true;
      options.minifyIdentifiers = false;
    },
    outExtension() {
      return { js: ".mjs" } as any;
    },
  }),
  // Types at root for package types resolution
  withCommon({
    outDir: "dist",
    platform: "neutral",
    format: ["esm"],
    dts: true,
    clean: false,
    esbuildOptions(options) {
      options.metafile = true;
      options.define = {
        ...(options.define || {}),
        __TARGET__: JSON.stringify("universal"),
      };
    },
    outExtension() {
      return { js: ".unused.js" } as any; // not referenced
    },
  }),
]);
