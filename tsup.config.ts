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
    target: "es2022",
    ...overrides,
  } as const;
}

function makeEsbuildOptions(targetName: string) {
  return (options: any) => {
    options.metafile = true;
    options.target = "es2022";
    options.define = {
      ...(options.define || {}),
      __TARGET__: JSON.stringify(targetName),
    };
    options.keepNames = true;
    options.minifyIdentifiers = false;
  };
}

export default defineConfig([
  // Universal (fallback)
  withCommon({
    outDir: "dist/universal",
    platform: "neutral",
    format: ["esm", "cjs"],
    clean: true,
    dts: false,
    esbuildOptions: makeEsbuildOptions("universal"),
    outExtension({ format }) {
      return { js: format === "cjs" ? ".cjs" : ".mjs" };
    },
  }),
  // Node
  withCommon({
    outDir: "dist/node",
    platform: "node",
    format: ["esm", "cjs"],
    dts: false,
    clean: false,
    esbuildOptions: makeEsbuildOptions("node"),
    outExtension({ format }) {
      return { js: format === "cjs" ? ".cjs" : ".mjs" };
    },
  }),
  // Browser
  withCommon({
    outDir: "dist/browser",
    platform: "browser",
    format: ["esm", "cjs"],
    dts: false,
    clean: false,
    esbuildOptions: makeEsbuildOptions("browser"),
    outExtension({ format }) {
      return { js: format === "cjs" ? ".cjs" : ".mjs" };
    },
  }),

  // Edge (workers)
  withCommon({
    outDir: "dist/edge",
    platform: "neutral",
    format: ["esm", "cjs"],
    dts: false,
    clean: false,
    esbuildOptions: makeEsbuildOptions("edge"),
    outExtension({ format }) {
      return { js: format === "cjs" ? ".cjs" : ".mjs" };
    },
  }),
  // Types at root for package types resolution
  withCommon({
    outDir: "dist",
    platform: "neutral",
    format: ["esm"],
    dts: true,
    clean: false,
    esbuildOptions: makeEsbuildOptions("universal"),
    outExtension() {
      return { js: ".unused.js" } as any; // not referenced
    },
  }),
]);
