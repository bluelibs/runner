import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
  },
  format: ["cjs", "esm"],
  platform: "neutral",
  sourcemap: true,
  dts: true,
  clean: true,
  outDir: "dist",
  splitting: false,
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".mjs" };
  },
  treeshake: true,
  minify: false,
  tsconfig: "tsconfig.build.json",
  esbuildOptions(options) {
    options.metafile = true; // one metafile *per* format, but same run
    options.keepNames = true; // keep class/function names (helps stability)
    options.minifyIdentifiers = false; // avoid identifier mangling drift
    // options.chunkNames = "chunks/[name]-[hash]";  // deterministic chunk names if you use splitting
  },
});
