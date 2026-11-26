import { expect, it } from 'vitest';
import { formatClock, formatSpeed } from './Hud.ts';

it('formats the clock', () => { expect(formatClock(6.25)).toBe('06:15'); });
it('formats the speedometer as whole km/h, reverse shown positive', () => {
  expect(formatSpeed(0)).toBe('0 km/h');
  expect(formatSpeed(47.6)).toBe('48 km/h');
  expect(formatSpeed(-12.2)).toBe('12 km/h');
});
