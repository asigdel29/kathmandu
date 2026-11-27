import { describe, expect, it } from 'vitest';
import {
  ENV_REFRESH_HOURS, EXPOSURE_DAY, EXPOSURE_NIGHT, FOG_DENSITY, HEMI_INTENSITY_DAY, HEMI_INTENSITY_NIGHT, LAMP_DECAY, LAMP_DISTANCE_M,
  LAMP_MAX_LIGHTS, MOON_INTENSITY, SHADOW_MAP_SIZE, SKY_MIE, SKY_RAYLEIGH, SKY_TURBIDITY, SUN_NOON_INTENSITY, WINDOW_EMISSIVE,
  lightingAt, needsEnvRefresh, skyNightLayer, sunDirection,
} from './lighting.ts';

const within = (x: number, lo: number, hi: number) => x >= lo && x <= hi;

describe('lighting constants (card targets)', () => {
  it('sky, exposure, sun', () => {
    expect(within(SKY_TURBIDITY, 4, 6)).toBe(true);
    expect(within(SKY_RAYLEIGH, 1.2, 2)).toBe(true);
    expect(within(SKY_MIE, 0.005, 0.02)).toBe(true);
    expect(within(EXPOSURE_DAY, 0.55, 0.75)).toBe(true);
    expect(within(EXPOSURE_NIGHT, 0.55, 0.75)).toBe(true);
    expect(within(SUN_NOON_INTENSITY, 2, 3)).toBe(true);
  });
  it('ambient, fog, shadows, lamps, windows', () => {
    expect(within(HEMI_INTENSITY_DAY, 0.5, 0.8)).toBe(true);
    expect(within(HEMI_INTENSITY_NIGHT, 0.08, 0.12)).toBe(true);
    expect(within(FOG_DENSITY, 0.00008, 0.00015)).toBe(true);
    expect(SHADOW_MAP_SIZE).toBe(4096);
    expect(LAMP_MAX_LIGHTS).toBe(24);
    expect(LAMP_DISTANCE_M).toBe(18);
    expect(LAMP_DECAY).toBe(2);
    expect(within(WINDOW_EMISSIVE, 0.6, 1)).toBe(true);
    expect(MOON_INTENSITY).toBe(0.15);
  });
});

describe('lightingAt', () => {
  it('sun scales with elevation and stays within 2-3 at midday', () => {
    const noon = lightingAt(12); const four = lightingAt(16.5); const dusk = lightingAt(17.2);
    expect(within(noon.lightIntensity, 2, 3)).toBe(true);
    expect(four.lightIntensity).toBeGreaterThan(dusk.lightIntensity);
    expect(noon.lightIntensity).toBeGreaterThanOrEqual(four.lightIntensity);
    expect(dusk.lightIntensity).toBeLessThan(noon.lightIntensity);
  });
  it('is warmer (redder) low in the sky than at noon', () => {
    const low = lightingAt(17).lightColor; const high = lightingAt(12).lightColor;
    expect(low.g / low.r).toBeLessThan(high.g / high.r);
  });
  it('night: moon at 0.15 pointing up, ambient 0.08-0.12, deep-blue sky layer (not black)', () => {
    for (const t of [19, 23, 2]) {
      const s = lightingAt(t);
      expect(s.night).toBe(1);
      expect(s.lightIntensity).toBeCloseTo(MOON_INTENSITY, 5);
      expect(s.lightDirection.y).toBeGreaterThan(0);
      expect(within(s.hemiIntensity, 0.08, 0.12)).toBe(true);
      expect(s.skyZenithAdd.b).toBeGreaterThan(s.skyZenithAdd.r);
      expect(s.skyHorizonAdd.b).toBeGreaterThan(0.02);
    }
  });
  it('fog colour follows the horizon and changes with the time of day, density stays in range', () => {
    const colours = [6.5, 12, 16.5, 19, 23].map((t) => lightingAt(t));
    for (const s of colours) expect(within(s.fogDensity, 0.00008, 0.00015)).toBe(true);
    const noon = colours[1]!.fogColor; const night = colours[4]!.fogColor;
    expect(night.b).toBeGreaterThan(night.r); // blue night
    expect(noon.r + noon.g + noon.b).toBeGreaterThan(5 * (night.r + night.g + night.b)); // far brighter by day
    for (const s of colours) { expect(Number.isFinite(s.fogColor.r + s.fogColor.g + s.fogColor.b)).toBe(true); }
  });
  it('exposure stays within 0.55-0.75 all day', () => {
    for (let t = 0; t < 24; t += 0.25) expect(within(lightingAt(t).exposure, 0.55, 0.75)).toBe(true);
  });
  it('sun direction rises in the east (+x), stands south at noon', () => {
    expect(sunDirection(8).x).toBeGreaterThan(0);
    expect(sunDirection(16).x).toBeLessThan(0);
    expect(sunDirection(12).z).toBeGreaterThan(0);
  });
});

describe('skyNightLayer', () => {
  it('is zero by day and fades in through twilight', () => {
    expect(skyNightLayer(30).horizon).toEqual([0, 0, 0]);
    const dusk = skyNightLayer(-2).horizon; const night = skyNightLayer(-20).horizon;
    expect(dusk[0]).toBeGreaterThan(night[0]); // warm glow at dusk
  });
});

describe('needsEnvRefresh', () => {
  it('refreshes first, then only after 30 game minutes, across midnight too', () => {
    expect(needsEnvRefresh(undefined, 12)).toBe(true);
    expect(needsEnvRefresh(12, 12 + ENV_REFRESH_HOURS * 0.9)).toBe(false);
    expect(needsEnvRefresh(12, 12.5)).toBe(true);
    expect(needsEnvRefresh(12.5, 12)).toBe(true);
    expect(needsEnvRefresh(23.9, 0.1)).toBe(false);
    expect(needsEnvRefresh(23.8, 0.4)).toBe(true);
  });
});
