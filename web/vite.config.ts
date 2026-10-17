/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Dev server proxies /api (REST + WebSocket) to the FastAPI backend, so the browser never needs CORS
// and the app works fully offline against a local backend.
const backend = process.env.VITE_BACKEND_URL ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": { target: backend, changeOrigin: true, ws: true, rewrite: (p) => p.replace(/^\/api/, "") } },
  },
  preview: {
    port: 5173,
    proxy: { "/api": { target: backend, changeOrigin: true, ws: true, rewrite: (p) => p.replace(/^\/api/, "") } },
  },
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ["three", "@react-three/fiber", "@react-three/drei"],
          charts: ["recharts"],
        },
      },
    },
  },
  test: { environment: "jsdom", globals: true, setupFiles: ["./src/test/setup.ts"], css: false },
});
