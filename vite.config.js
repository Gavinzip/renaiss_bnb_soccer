import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

function localApiProxy(target) {
  if (!target) return undefined;
  return {
    "/api": {
      target,
      changeOrigin: true,
    },
    "/health": {
      target,
      changeOrigin: true,
    },
    "/lucky-draw-ledger.json": {
      target,
      changeOrigin: true,
    },
    "/match-draw-ledger.json": {
      target,
      changeOrigin: true,
    },
    "/draw-winners.json": {
      target,
      changeOrigin: true,
    },
    "/vote-preview.json": {
      target,
      changeOrigin: true,
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const localApiOrigin = String(env.VITE_LOCAL_API_ORIGIN || "").trim();

  return {
    plugins: [react()],
    server: {
      proxy: localApiProxy(localApiOrigin),
    },
  };
});
