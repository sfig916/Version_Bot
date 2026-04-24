import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  root: '.',
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@core': path.resolve(__dirname, './src/core'),
      '@main': path.resolve(__dirname, './src/main'),
      '@renderer': path.resolve(__dirname, './src/renderer'),
    },
  },
  server: {
    port: 5173,
  },
});
