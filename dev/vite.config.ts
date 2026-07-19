import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Set VITE_BASE_PATH=/PokePlanner/ for GitHub Pages; root is used locally and on Cloudflare.
  base: process.env.VITE_BASE_PATH ?? '/',
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
  },
});
