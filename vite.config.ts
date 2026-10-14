/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { apiDevPlugin } from './scripts/vite-api-plugin';
import { serviceWorkerPlugin } from './scripts/vite-sw-plugin';

export default defineConfig({
  plugins: [react(), serviceWorkerPlugin(), apiDevPlugin()],
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'server/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
  },
});
