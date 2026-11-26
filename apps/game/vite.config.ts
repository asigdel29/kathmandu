import { defineConfig, type Plugin } from 'vite';

// Local builds write dist/tiles/<id>/<file>; published tiles live at tiles/<id>/<inputsHash>/<file>.
// In dev and preview, drop the hash segment so the runtime uses one URL scheme everywhere.
function localTileHashes(): Plugin {
  const strip = (url: string | undefined) => url?.replace(/^(\/world\/tiles\/[^/]+)\/[0-9a-f]{64}\//, '$1/');
  return {
    name: 'local-tile-hashes',
    configureServer(server) { server.middlewares.use((req, _res, next) => { req.url = strip(req.url); next(); }); },
    configurePreviewServer(server) { server.middlewares.use((req, _res, next) => { req.url = strip(req.url); next(); }); },
  };
}

export default defineConfig({
  plugins: [localTileHashes()],
  server: { port: 5173, strictPort: true, fs: { allow: ['../..'] } },
  build: { target: 'es2022', sourcemap: true },
  optimizeDeps: { exclude: ['@dimforge/rapier3d-compat'] },
});
