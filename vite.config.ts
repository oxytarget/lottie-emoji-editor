/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  // On Vercel the bot API (api/*.ts) is served from the same origin as the site,
  // unless an explicit VITE_BOT_API_URL is configured (env var or .env.production).
  const sameOriginApi = process.env.VERCEL && !env.VITE_BOT_API_URL;

  return {
    // Relative base so the build works from any sub-path (GitHub Pages, Telegram Mini App hosting, etc.)
    base: './',
    plugins: [react()],
    define: sameOriginApi ? { 'import.meta.env.VITE_BOT_API_URL': JSON.stringify('/') } : {},
    server: { host: true },
    build: {
      // lottie-web + opentype.js make up most of the bundle; a single chunk is fine for this app.
      chunkSizeWarningLimit: 1000,
    },
    test: {
      environment: 'jsdom',
    },
  };
});
