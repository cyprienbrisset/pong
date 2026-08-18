import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    // Les sources sont publiées : le jeu est destiné à être bricolé par l'équipe.
    sourcemap: true,
    rollupOptions: {
      output: {
        // Noms versionnés : le serveur peut les servir en cache immuable.
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      // En développement, le client sur 5173 parle au serveur de jeu sur 3000.
      '/ws': { target: 'ws://localhost:3000', ws: true },
      '/api': 'http://localhost:3000',
    },
  },
});
