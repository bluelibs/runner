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
    esbuildOptions: makeEsbuildOptions("universal"),
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
    esbuildOptions: makeEsbuildOptions("node"),
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
    esbuildOptions: makeEsbuildOptions("node"),
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
    esbuildOptions: makeEsbuildOptions("browser"),
    outExtension() {
      return { js: ".mjs" } as any;
    },
  }),
  // Browser CJS for legacy consumers that require() the package
  withCommon({
    outDir: "dist/browser",
    platform: "browser",
    format: ["cjs"],
    dts: false,
    clean: false,
    esbuildOptions: makeEsbuildOptions("browser"),
    outExtension() {
      return { js: ".cjs" } as any;
    },
  }),

  // Edge (workers)
  withCommon({
    outDir: "dist/edge",
    platform: "neutral",
    format: ["esm"],
    dts: false,
    clean: false,
    esbuildOptions: makeEsbuildOptions("edge"),
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
    esbuildOptions: makeEsbuildOptions("universal"),
    outExtension() {
      return { js: ".unused.js" } as any; // not referenced
    },
  }),
]);
