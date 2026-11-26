import { defineConfig, type Plugin } from 'vite';

// Local builds write dist/tiles/<id>/<file> and dist/heroes/<slug>/<file>; published assets live at
// tiles/<id>/<inputsHash>/<file> and heroes/<slug>/<sha256>/<file>.
// In dev and preview, drop the hash segment so the runtime uses one URL scheme everywhere.
function localTileHashes(): Plugin {
  const strip = (url: string | undefined) => url?.replace(/^(\/world\/(?:tiles|heroes)\/[^/]+)\/[0-9a-f]{64}\//, '$1/');
  return {
    name: 'local-tile-hashes',
    configureServer(server) { server.middlewares.use((req, _res, next) => { req.url = strip(req.url); next(); }); },
    configurePreviewServer(server) { server.middlewares.use((req, _res, next) => { req.url = strip(req.url); next(); }); },
  };
}

export default defineConfig({
  plugins: [localTileHashes()],
  // No SPA fallback: a missing optional asset (water.glb, a hero model) must be a 404, not index.html.
  appType: 'mpa',
  server: { port: 5173, strictPort: true, fs: { allow: ['../..'] } },
  build: { target: 'es2022', sourcemap: true },
  optimizeDeps: { exclude: ['@dimforge/rapier3d-compat'] },
});
