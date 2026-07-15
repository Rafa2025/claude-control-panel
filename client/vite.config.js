import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4310',
        // installs can pull many files; don't let the dev proxy cut a slow one off
        timeout: 120000,
        proxyTimeout: 120000,
      },
    },
  },
});
