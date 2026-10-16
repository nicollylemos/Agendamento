import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Em dev, /api vai para a API. Assim front e API ficam na mesma origem
    // e o cookie de sessão (SameSite=Strict) funciona sem liberar CORS.
    proxy: { '/api': 'http://localhost:3333' },
  },
});
