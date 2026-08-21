import { defineConfig } from "vite";

const apiPort = process.env.LINEAGE_LOGO_PORT ?? "4173";

export default defineConfig({
  root: "src/client",
  build: {
    emptyOutDir: true,
    outDir: "../../dist/client",
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": `http://127.0.0.1:${apiPort}`,
    },
  },
});
