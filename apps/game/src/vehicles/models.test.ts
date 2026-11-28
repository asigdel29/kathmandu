import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VehicleTunings, VehicleType } from '@ktm/schema';
import vehiclesJson from '../../../../world/vehicles.json';
import { wheelLayout } from './Vehicle.ts';
import { WHEEL_NODES, bodyWithRider, createRiderGeometry, parseVehicleModel, steerableWheels } from './models.ts';

const tunings = VehicleTunings.parse(vehiclesJson).vehicles;

function mesh(geo: THREE.BufferGeometry, material: THREE.MeshStandardMaterial, name = ''): THREE.Mesh {
  const m = new THREE.Mesh(geo, material); m.name = name; return m;
}

/** A tiny two-axle vehicle: body box at y = 1, a lamp child, four wheels with their origin at the hub. */
function toyCar(): THREE.Group {
  const root = new THREE.Group(); root.name = 'taxi';
  const body = mesh(new THREE.BoxGeometry(1, 1, 3), new THREE.MeshStandardMaterial({ color: 0xff0000, roughness: 0.3, metalness: 0.1 }), 'body');
  body.position.set(0, 1, 0);
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xffffff }); lampMat.name = 'light_head';
  const lamp = mesh(new THREE.BoxGeometry(0.2, 0.1, 0.05), lampMat);
  lamp.position.set(0.3, 0, 1.5);
  body.add(lamp);
  root.add(body);
  for (const [name, x, z] of [['wheel_fl', 0.7, 1.2], ['wheel_fr', -0.7, 1.2], ['wheel_rl', 0.7, -1.2], ['wheel_rr', -0.7, -1.2]] as const) {
    const w = mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.2, 8).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x111111 }), name);
    w.position.set(x, 0.3, z);
    root.add(w);
  }
  return root;
}

describe('parseVehicleModel', () => {
  it('bakes body parts into one geometry with colour and surface attributes', () => {
    const m = parseVehicleModel('taxi', toyCar());
    const g = m.body;
    expect(Object.keys(g.attributes).sort()).toEqual(['color', 'normal', 'position', 'surf']);
    const pos = g.getAttribute('position'); const col = g.getAttribute('color'); const surf = g.getAttribute('surf');
    expect(col.itemSize).toBe(3); expect(surf.itemSize).toBe(3);
    // body box (24 vertices) + lamp box (24)
    expect(pos.count).toBe(48);
    g.computeBoundingBox();
    expect(g.boundingBox!.min.y).toBeCloseTo(0.5); // box centred at y = 1, half height 0.5
    expect(g.boundingBox!.max.z).toBeCloseTo(1.5 + 0.025);
    // body vertices: red, roughness 0.3, metalness 0.1, not emissive; lamp vertices emissive
    expect(col.getX(0)).toBeCloseTo(1); expect(col.getY(0)).toBeCloseTo(0);
    expect(surf.getX(0)).toBeCloseTo(0.3); expect(surf.getY(0)).toBeCloseTo(0.1); expect(surf.getZ(0)).toBe(0);
    expect(surf.getZ(30)).toBe(1);
    expect(g.index).not.toBeNull();
  });

  it('extracts wheels in WHEEL_NODES order with hub-centred geometry', () => {
    const m = parseVehicleModel('taxi', toyCar());
    expect(m.wheels.map((w) => w.name)).toEqual(WHEEL_NODES.taxi);
    expect(m.wheels[0]!.position.toArray()).toEqual([0.7, 0.3, 1.2].map((v) => expect.closeTo(v, 5)));
    const g = m.wheels[3]!.geometry; g.computeBoundingBox();
    const c = g.boundingBox!.getCenter(new THREE.Vector3());
    expect(c.length()).toBeLessThan(1e-5);
    expect(g.boundingBox!.max.y).toBeCloseTo(0.3);
    expect(m.wheelRadius).toBeCloseTo(0.3);
  });

  it('keeps wheel meshes out of the body geometry', () => {
    const m = parseVehicleModel('taxi', toyCar());
    m.body.computeBoundingBox();
    expect(m.body.boundingBox!.min.y).toBeGreaterThan(0.4);
  });

  it('reads the rider anchor when present', () => {
    const car = toyCar();
    const r = new THREE.Object3D(); r.name = 'rider'; r.position.set(0, 0.9, -0.1);
    car.add(r);
    expect(parseVehicleModel('taxi', car).rider?.toArray()).toEqual([0, expect.closeTo(0.9, 5), expect.closeTo(-0.1, 5)]);
    expect(parseVehicleModel('taxi', toyCar()).rider).toBeUndefined();
  });

  it('names every missing node', () => {
    const car = toyCar();
    car.getObjectByName('wheel_rr')!.removeFromParent();
    car.getObjectByName('body')!.removeFromParent();
    expect(() => parseVehicleModel('taxi', car)).toThrow(/body.*wheel_rr|wheel_rr.*body/);
  });

  it('applies the parent transform of nested nodes', () => {
    const car = toyCar();
    const holder = new THREE.Group(); holder.position.set(0, 0, 5);
    for (const c of [...car.children]) holder.add(c);
    car.add(holder);
    const m = parseVehicleModel('taxi', car);
    expect(m.wheels[0]!.position.z).toBeCloseTo(6.2);
    m.body.computeBoundingBox();
    expect(m.body.boundingBox!.max.z).toBeCloseTo(6.5 + 0.025);
  });
});

describe('steerableWheels', () => {
  it('marks the front wheels', () => {
    expect(steerableWheels('taxi')).toEqual([true, true, false, false]);
    expect(steerableWheels('tempo')).toEqual([true, false, false]);
    expect(steerableWheels('motorbike')).toEqual([true, false]);
  });
});

describe('createRiderGeometry', () => {
  const g = createRiderGeometry();
  g.computeBoundingBox();
  const b = g.boundingBox!;

  it('carries the same attributes as a baked body, with no lamps', () => {
    expect(Object.keys(g.attributes).sort()).toEqual(['color', 'normal', 'position', 'surf']);
    const surf = g.getAttribute('surf');
    for (let i = 0; i < surf.count; i++) expect(surf.getZ(i)).toBe(0);
    expect(g.getAttribute('color').count).toBe(g.getAttribute('position').count);
  });

  it('is a seated person around the hip origin: helmet about 0.8 m up, feet about 0.5 m down, hands forward', () => {
    expect(b.max.y).toBeGreaterThan(0.7); expect(b.max.y).toBeLessThan(0.95);
    expect(b.min.y).toBeLessThan(-0.35); expect(b.min.y).toBeGreaterThan(-0.7);
    expect(b.max.z).toBeGreaterThan(0.4); expect(b.max.z).toBeLessThan(0.8);
    expect(b.max.x).toBeLessThan(0.5); expect(b.min.x).toBeGreaterThan(-0.5);
  });

  it('is cheap', () => {
    expect(g.index!.count / 3).toBeLessThan(500);
  });
});

describe('bodyWithRider', () => {
  it('adds the rider at the seat and leaves the model untouched', () => {
    const car = toyCar();
    const r = new THREE.Object3D(); r.name = 'rider'; r.position.set(0, 0.9, -0.1);
    car.add(r);
    const m = parseVehicleModel('taxi', car);
    const before = m.body.getAttribute('position').count;
    const withRider = bodyWithRider(m);
    expect(m.body.getAttribute('position').count).toBe(before);
    expect(withRider.getAttribute('position').count).toBeGreaterThan(before);
    withRider.computeBoundingBox();
    expect(withRider.boundingBox!.max.y).toBeGreaterThan(1.5);
  });

  it('returns the body itself when there is no rider anchor', () => {
    const m = parseVehicleModel('taxi', toyCar());
    expect(bodyWithRider(m)).toBe(m.body);
  });
});

const MODEL_DIR = new URL('../../public/models/vehicles/', import.meta.url);

async function load(type: VehicleType): Promise<{ bytes: number; root: THREE.Object3D }> {
  const url = new URL(`${type}.glb`, MODEL_DIR);
  const buf = readFileSync(url);
  const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  return { bytes: statSync(url).size, root: gltf.scene };
}

function triangles(g: THREE.BufferGeometry): number { return (g.index ? g.index.count : g.getAttribute('position').count) / 3; }

const loaded = Object.fromEntries(await Promise.all(VehicleType.options.map(async (type) => [type, await load(type)] as const))) as Record<VehicleType, { bytes: number; root: THREE.Object3D }>;

describe.each(VehicleType.options)('%s.glb', (type) => {
  const t = tunings[type];
  const { bytes, root } = loaded[type];
  const model = parseVehicleModel(type, root);

  it('fits the asset budget', () => {
    expect(bytes).toBeLessThan(8 * 1024 * 1024);
    const tris = triangles(model.body) + model.wheels.reduce((s, w) => s + triangles(w.geometry), 0);
    expect(tris).toBeLessThan(15_000);
  });

  it('has the wheel nodes where the physics wheels are, at the tuned radius', () => {
    const spots = wheelLayout(type, t);
    const visual = type === 'motorbike' ? [spots[0]!, spots[2]!] : spots;
    expect(model.wheels).toHaveLength(visual.length);
    model.wheels.forEach((w, i) => {
      const s = visual[i]!;
      expect(w.position.x, `${w.name} x`).toBeCloseTo(type === 'motorbike' ? 0 : s.x, 1);
      expect(w.position.z, `${w.name} z`).toBeCloseTo(s.z, 1);
      expect(w.position.y, `${w.name} y`).toBeCloseTo(t.wheelRadius, 1);
    });
    expect(model.wheelRadius).toBeCloseTo(t.wheelRadius, 1);
  });

  it('is about as long and wide as its collider box', () => {
    model.body.computeBoundingBox();
    const b = model.body.boundingBox!;
    expect(b.min.y).toBeGreaterThanOrEqual(-0.001); // nothing below the ground plane
    expect(b.max.z - b.min.z).toBeGreaterThan(t.length * 0.8);
    expect(b.max.z - b.min.z).toBeLessThan(t.length * 1.1);
    expect(b.max.x - b.min.x).toBeLessThan(t.width * 1.35);
    expect(b.max.x - b.min.x).toBeGreaterThan(t.width * 0.6);
  });

  it('has lamps that can glow at night', () => {
    const surf = model.body.getAttribute('surf');
    let lit = 0;
    for (let i = 0; i < surf.count; i++) if (surf.getZ(i) > 0.5) lit++;
    expect(lit).toBeGreaterThanOrEqual(16);
  });

  it(type === 'motorbike' ? 'has a rider anchor above the seat' : 'needs no rider anchor', () => {
    if (type === 'motorbike') {
      expect(model.rider).toBeDefined();
      expect(model.rider!.y).toBeGreaterThan(0.6);
    } else expect(model.rider).toBeUndefined();
  });
});
