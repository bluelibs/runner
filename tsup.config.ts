import { defineConfig } from "tsup";

type BuildFormat = "esm" | "cjs";

const ENTRY = { index: "src/index.ts" } as const;
const EXTERNAL = ["async_hooks", "node:async_hooks"] as const;
const SHARED = {
  entry: ENTRY,
  platform: "neutral" as const,
  external: [...EXTERNAL],
  sourcemap: true,
  outDir: "dist",
  splitting: false,
  treeshake: true,
  minify: false,
  tsconfig: "tsconfig.build.json",
};

const build = (format: BuildFormat) => ({
  ...SHARED,
  format: [format],
  // Only clean once (on the first/ESM build)
  clean: format === "esm",
  // Only emit types on the CJS build to match package.json
  dts: format === "cjs",
  outExtension() {
    return { js: format === "esm" ? ".mjs" : ".cjs" };
  },
  esbuildOptions(options: import("esbuild").BuildOptions) {
    options.metafile = true; // one metafile per format
    options.define = {
      ...(options.define || {}),
      __BUILD_FORMAT__: JSON.stringify(format),
    };
    options.keepNames = true; // keep class/function names (helps stability)
    options.minifyIdentifiers = false; // avoid identifier mangling drift
  },
});

export default defineConfig([build("esm"), build("cjs")]);
