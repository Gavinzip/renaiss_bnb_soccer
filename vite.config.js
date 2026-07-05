import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

function localApiProxy(target) {
  if (!target) return undefined;
  return {
    "/api": {
      target,
      changeOrigin: true,
    },
    "/auth": {
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

function readOnlyApiProxy(target) {
  if (!target) return undefined;
  const createTarget = () => ({
    target,
    changeOrigin: true,
  });

  return {
    "/api/raffle-summary": createTarget(),
    "/api/raffle-entry": createTarget(),
    "/api/raffle-ticket-lookup": createTarget(),
    "/api/milestones": createTarget(),
    "/api/vote-preview": createTarget(),
    "/api/match-results": createTarget(),
    "/api/live-qualification": createTarget(),
    "/api/live-round32-matches": createTarget(),
    "/api/live-round16-matches": createTarget(),
    "/api/live-future-knockout-matches": createTarget(),
    "/api/draw-winners": createTarget(),
    "/api/draw-admin/status": createTarget(),
    "/api/auth/verification-stats": createTarget(),
    "/lucky-draw-ledger.json": createTarget(),
    "/match-draw-ledger.json": createTarget(),
    "/draw-winners.json": createTarget(),
    "/vote-preview.json": createTarget(),
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const readApiOrigin = String(env.LOCAL_READ_API_ORIGIN || "").trim();
  const localApiOrigin = String(env.VITE_LOCAL_API_ORIGIN || "").trim();

  return {
    plugins: [react()],
    server: {
      proxy: readApiOrigin ? readOnlyApiProxy(readApiOrigin) : localApiProxy(localApiOrigin),
    },
  };
});
