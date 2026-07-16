import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  root: ".",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    host: true,
    port: 5173,
    // In dev, vite serves the frontend on 5173 and the API server runs
    // separately (`npm run dev:server`) on 8080 — proxy /api across so the
    // client can always just call relative `/api/...` paths, matching
    // production where one Railway service serves both from the same origin.
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    target: "es2020",
  },
});
