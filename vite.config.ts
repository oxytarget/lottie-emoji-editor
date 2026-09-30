/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative base so the build works from any sub-path (GitHub Pages, Telegram Mini App hosting, etc.)
  base: './',
  plugins: [react()],
  server: { host: true },
  build: {
    // lottie-web + opentype.js make up most of the bundle; a single chunk is fine for this app.
    chunkSizeWarningLimit: 1000,
  },
  test: {
    environment: 'jsdom',
  },
});
