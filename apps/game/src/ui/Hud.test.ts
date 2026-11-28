import { expect, it } from 'vitest';
import { formatClock, formatSpeed, formatTraffic, relativeBearing } from './Hud.ts';

it('formats the clock', () => { expect(formatClock(6.25)).toBe('06:15'); });
it('formats the speedometer as whole km/h, reverse shown positive', () => {
  expect(formatSpeed(0)).toBe('0 km/h');
  expect(formatSpeed(47.6)).toBe('48 km/h');
  expect(formatSpeed(-12.2)).toBe('12 km/h');
});
it('formats the traffic count', () => {
  expect(formatTraffic(0)).toBe('0 vehicles');
  expect(formatTraffic(1)).toBe('1 vehicle');
  expect(formatTraffic(42)).toBe('42 vehicles');
});
it('turns the waypoint bearing into an arrow angle relative to the camera', () => {
  expect(relativeBearing(90, 0)).toBe(90);
  expect(relativeBearing(10, 350)).toBe(20);
  expect(relativeBearing(350, 10)).toBe(-20);
  expect(relativeBearing(180, 0)).toBe(-180);
});
