import { Manifest } from '@ktm/schema';
export async function loadManifest(base: string): Promise<Manifest> {
  const res = await fetch(`${base}manifest.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`manifest: HTTP ${res.status}`);
  return Manifest.parse(await res.json());
}
