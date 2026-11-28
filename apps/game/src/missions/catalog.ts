import { Mission } from '@ktm/schema';

/** Parses bundled mission files keyed by path; each file must be named `<id>.json`. Sorted by id. */
export function parseCatalog(files: Record<string, unknown>): Mission[] {
  const out: Mission[] = [];
  for (const [path, data] of Object.entries(files)) {
    const name = path.slice(path.lastIndexOf('/') + 1);
    const r = Mission.safeParse(data);
    if (!r.success) throw new Error(`mission ${name}: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    if (`${r.data.id}.json` !== name) throw new Error(`mission ${name}: id "${r.data.id}" does not match the file name`);
    out.push(r.data);
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// world/missions/*.json is bundled into the app at build time (docs/contracts.md section 12), like world/vehicles.json.
const files = import.meta.glob<unknown>('../../../../world/missions/*.json', { eager: true, import: 'default' });
export const MISSIONS: readonly Mission[] = parseCatalog(files);
