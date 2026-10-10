import { defineConfig } from 'vite';

// Build statique pour GitHub Pages (https://mge-agilos.github.io/VRSales/) : pas de serveur, donc pas de proxy
// ni de présence ; chaque visiteur se connecte avec son compte Qlik (src/qlik-oauth.js).
// En local, la pièce reste servie par le serveur Vite du dossier parent (proxy Qlik + présence).
export default defineConfig({
  root: import.meta.dirname,
  base: '/VRSales/',
  publicDir: false,
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 3000 },
});
