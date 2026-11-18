import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// No @vitejs/plugin-react needed: Vite transpiles TSX with esbuild out of the
// box. Keeping the dashboard on the root project's already-installed Vite
// avoids a second ~45 MB install.
const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
});
