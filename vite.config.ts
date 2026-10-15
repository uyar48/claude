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
        // Course data and media manifests change rarely and separately from the code.
        manualChunks(id) {
          if (/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\//.test(id)) return 'react';
          if (id.includes('node_modules/@supabase/')) return 'supabase';
          if (id.includes('/content/build/course.json')) return 'course';
          if (id.includes('/content/media/credits.json') || id.includes('/src/content/media-manifest.json')) return 'media';
        },
      },
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'server/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
  },
});
