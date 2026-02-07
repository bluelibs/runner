import { defineConfig } from "tsup";
type BuildFormat = "cjs" | "esm" | "iife";

const COMMON = {
  splitting: false,
  sourcemap: true,
  treeshake: true,
  minify: false,
  tsconfig: "config/ts/tsconfig.build.json",
  external: ["async_hooks", "node:async_hooks"],
  dts: false,
  target: "es2022",
};

const makeEsbuildOptions = (target: string) => (options: any) => {
  options.metafile = true;
  options.target = "es2022";
  options.define = {
    ...(options.define || {}),
    __TARGET__: JSON.stringify(target),
  };
  options.keepNames = true;
  options.minifyIdentifiers = false;
};

const outExtension = (ctx: { format: BuildFormat }) => ({
  js: ctx.format === "cjs" ? ".cjs" : ".mjs",
});

export default defineConfig([
  {
    ...COMMON,
    entry: { index: "src/index.ts" },
    outDir: "dist/universal",
    platform: "neutral",
    format: ["esm", "cjs"],
    clean: true,
    esbuildOptions: makeEsbuildOptions("universal"),
    outExtension,
  },
  {
    ...COMMON,
    entry: { node: "src/node/index.ts" },
    outDir: "dist/node",
    platform: "node",
    format: ["esm", "cjs"],
    external: ["busboy", ...COMMON.external],
    clean: false,
    esbuildOptions: makeEsbuildOptions("node"),
    outExtension,
  },
  {
    ...COMMON,
    entry: { index: "src/index.ts" },
    outDir: "dist/browser",
    platform: "browser",
    format: ["esm", "cjs"],
    clean: false,
    esbuildOptions: makeEsbuildOptions("browser"),
    outExtension,
  },
  {
    ...COMMON,
    entry: { index: "src/index.ts" },
    outDir: "dist/edge",
    platform: "neutral",
    format: ["esm", "cjs"],
    clean: false,
    esbuildOptions: makeEsbuildOptions("edge"),
    outExtension,
  },
]);
