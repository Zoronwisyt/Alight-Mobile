import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/Alight-Mobile/' : './',
  plugins: [react()],
  build: {
    target: 'esnext',
  },
  server: {
    port: 5173,
    strictPort: false,
  },
});
