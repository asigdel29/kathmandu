import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { defineConfig, type Connect, type Plugin } from 'vite';

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

const TYPES: Record<string, string> = { '.json': 'application/json', '.glb': 'model/gltf-binary', '.f32': 'application/octet-stream' };

// With KTM_WORLD_DIR set (absolute path), /world/* is served from that directory; missing files are 404
// (the tile loader treats 404 on optional files as absent). Registered after the hash strip.
function worldDir(): Plugin {
  const root = process.env.KTM_WORLD_DIR ? normalize(process.env.KTM_WORLD_DIR).replace(/[\\/]+$/, '') : undefined;
  const serve: Connect.NextHandleFunction = (req, res, next) => {
    const path = req.url?.split('?')[0];
    if (!root || !path?.startsWith('/world/')) { next(); return; }
    const file = normalize(join(root, decodeURIComponent(path.slice('/world/'.length))));
    if (!file.startsWith(root + sep)) { res.statusCode = 403; res.end(); return; }
    let size: number;
    try { const s = statSync(file); if (!s.isFile()) throw new Error('not a file'); size = s.size; } catch { res.statusCode = 404; res.end(); return; }
    res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
    res.setHeader('Content-Length', size);
    res.setHeader('Cache-Control', 'no-cache');
    createReadStream(file).pipe(res);
  };
  return {
    name: 'ktm-world-dir',
    configureServer(server) { server.middlewares.use(serve); },
    configurePreviewServer(server) { server.middlewares.use(serve); },
  };
}

export default defineConfig({
  plugins: [localTileHashes(), worldDir()],
  // No SPA fallback: a missing optional asset (water.glb, a hero model) must be a 404, not index.html.
  appType: 'mpa',
  server: { port: 5173, strictPort: true, fs: { allow: ['../..'] } },
  build: { target: 'es2022', sourcemap: true },
  optimizeDeps: { exclude: ['@dimforge/rapier3d-compat'] },
});
