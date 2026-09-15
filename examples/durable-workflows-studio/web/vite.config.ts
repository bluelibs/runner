import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Relative assets so the build also runs from file:// and behind any path.
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5193,
    proxy: {
      "/api": "http://127.0.0.1:4317",
    },
  },
});
