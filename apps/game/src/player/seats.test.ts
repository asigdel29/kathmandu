import { describe, expect, it } from 'vitest';
import { VehicleType } from '@ktm/schema';
import { seatOffset } from './Character.ts';

describe('seatOffset', () => {
  it('has a seat for every vehicle type, as a copy', () => {
    for (const type of VehicleType.options) {
      const a = seatOffset(type);
      a.x += 10;
      expect(seatOffset(type).x).not.toBe(a.x);
    }
  });

  it('puts the driver on the right-hand side (-X) of every enclosed vehicle', () => {
    for (const type of VehicleType.options) {
      if (type === 'motorbike') continue; // relative to the bike's rider node, on the centreline
      expect(seatOffset(type).x, type).toBeLessThan(0);
    }
  });

  it('seats the driver in the cab, forward of the vehicle centre for the long vehicles', () => {
    for (const type of ['micro', 'bus', 'truck'] as const) expect(seatOffset(type).z, type).toBeGreaterThan(0.5);
  });
});
