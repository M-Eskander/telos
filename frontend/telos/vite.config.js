import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev: /api is proxied to the backend so the session cookie stays same-site.
// Production: serve the built files and proxy /api from the same site.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': process.env.API_TARGET || 'http://localhost:5000' } },
});
