import { defineConfig } from "vite";

const apiPort = process.env.LINEAGE_LOGO_PORT ?? "4173";
const clientPort = Number(process.env.LINEAGE_LOGO_CLIENT_PORT ?? "5173");
const editorOrigin = `http://127.0.0.1:${clientPort}`;

export default defineConfig({
  root: "src/client",
  build: {
    emptyOutDir: true,
    outDir: "../../dist/client",
  },
  server: {
    host: "127.0.0.1",
    port: clientPort,
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${apiPort}`,
        configure: (proxy) => {
          proxy.on("proxyReq", (request) => request.setHeader("Origin", editorOrigin));
        },
      },
    },
  },
});
