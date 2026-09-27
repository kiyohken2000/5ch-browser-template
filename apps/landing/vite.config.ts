import { resolve } from "node:path";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        // トップページと、曖昧NG の説明ページ (/ai-ng.html)
        main: resolve(__dirname, "index.html"),
        aiNg: resolve(__dirname, "ai-ng.html"),
      },
    },
  },
});
