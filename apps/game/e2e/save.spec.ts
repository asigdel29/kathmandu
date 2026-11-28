import { expect, type Page, test } from '@playwright/test';

interface KtmWindow {
  __ktmReady?: boolean;
  __ktmDebug?: { driving: string | null };
  __ktm?: { player: { position: { x: number; z: number } }; clock: { time: number } };
}
interface Save { version: number; x: number; y: number; z: number; heading: number; timeOfDay: number; vehicle: string | null; savedAt: number }

const KEY = 'ktm.save.v1';

async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const w = window as unknown as KtmWindow;
    return w.__ktmReady === true || document.getElementById('hud')?.textContent?.startsWith('error:');
  }, null, { timeout: 120_000 });
  const hud = await page.locator('#hud').textContent();
  expect(hud?.startsWith('error:') ? hud : '', 'hud reports an error').toBe('');
}

/**
 * Leaving the game page saves its current state (visibilitychange on unload), so edit the entry from a
 * same-origin page that is not the game, then open the game at `url`.
 */
async function openWithSave(page: Page, save: Save, url: string): Promise<void> {
  await page.goto('/world/manifest.json');
  await page.evaluate(([k, v]) => localStorage.setItem(k!, v!), [KEY, JSON.stringify(save)]);
  await page.goto(url);
  await ready(page);
}

const readSave = (page: Page) => page.evaluate((k) => localStorage.getItem(k), KEY);
const state = (page: Page) => page.evaluate(() => {
  const w = window as unknown as KtmWindow;
  return { x: w.__ktm!.player.position.x, z: w.__ktm!.player.position.z, time: w.__ktm!.clock.time, driving: w.__ktmDebug!.driving };
});

test('reload resumes the saved position, time and vehicle', async ({ page }) => {
  const errors: Error[] = [];
  page.on('pageerror', (e) => { errors.push(e); });

  await page.goto('/?traffic=0&freeze=1');
  await ready(page);
  // A visibility change writes the entry straight away.
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  const first = JSON.parse((await readSave(page)) ?? 'null') as Save | null;
  expect(first).toMatchObject({ version: 1, vehicle: null });

  // Move the saved spot 15 m east, set the time to 09:00 and put the player in a taxi, then reopen the game.
  const edited: Save = { ...first!, x: first!.x + 15, timeOfDay: 9, vehicle: 'taxi' };
  await openWithSave(page, edited, '/?traffic=0&freeze=1');
  const resumed = await state(page);
  expect(resumed.driving).toBe('taxi');
  expect(resumed.time).toBeCloseTo(9, 3);

  // On foot, the player stands on the saved spot.
  await openWithSave(page, { ...edited, vehicle: null }, '/?traffic=0&freeze=1');
  const onFoot = await state(page);
  expect(onFoot.driving).toBeNull();
  expect(Math.hypot(onFoot.x - edited.x, onFoot.z - edited.z), 'distance from saved spot (m)').toBeLessThan(1);

  // A plain reload saves on the way out and comes back to the same spot.
  await page.reload();
  await ready(page);
  const reloaded = await state(page);
  expect(Math.hypot(reloaded.x - onFoot.x, reloaded.z - onFoot.z), 'distance after reload (m)').toBeLessThan(1);

  // Explicit parameters win, and reset=1 clears the entry.
  await page.goto('/?traffic=0&freeze=1&t=18:00');
  await ready(page);
  expect((await state(page)).time).toBeCloseTo(18, 3);
  await page.goto('/?traffic=0&freeze=1&reset=1');
  await ready(page);
  expect(await readSave(page)).toBeNull();
  expect(errors, 'page errors').toEqual([]);
});
