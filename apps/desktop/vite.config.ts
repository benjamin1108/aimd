import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        settings: resolve(__dirname, "settings.html"),
        extractor: resolve(__dirname, "extractor.html"),
      },
    },
  },
});
