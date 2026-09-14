import { defineConfig } from "vite";

// GitHub Pages project site: https://<user>.github.io/<repo>/
const repo = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "laughing-rotary-phone";

export default defineConfig({
  base: process.env.NODE_ENV === "production" ? `/${repo}/` : "/",
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000,
  },
  server: {
    headers: {
      // Required for SharedArrayBuffer if we enable it later
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
});
