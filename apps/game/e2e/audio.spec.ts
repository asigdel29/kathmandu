import { expect, test } from '@playwright/test';

interface AudioState { started: boolean; muted: boolean; loaded: number; ambience: string; weights: Record<string, number>; bellIn: number }
interface KtmWindow { __ktmReady?: boolean; __ktmDebug?: { audio?: AudioState; temples: number } }

test('audio starts on the first key press and N toggles mute', async ({ page }) => {
  const errors: Error[] = [];
  page.on('pageerror', (e) => { errors.push(e); });
  const audioRequests: string[] = [];
  page.on('requestfinished', (r) => { if (/\/audio\/[^/]+\.mp3/.test(r.url())) audioRequests.push(r.url()); });

  await page.goto('/?tile=x14_y17&vehicle=taxi&traffic=0');
  await page.waitForFunction(() => {
    const w = window as unknown as KtmWindow;
    return w.__ktmReady === true || document.getElementById('hud')?.textContent?.startsWith('error:');
  }, null, { timeout: 120_000 });
  const hud = await page.locator('#hud').textContent();
  expect(hud?.startsWith('error:') ? hud : '', 'hud reports an error').toBe('');

  const before = await page.evaluate(() => (window as unknown as KtmWindow).__ktmDebug?.audio);
  expect(before?.started, 'silent before any gesture').toBe(false);
  expect(audioRequests, 'no audio fetched before a gesture').toEqual([]);

  await page.keyboard.press('KeyH');
  await page.waitForFunction(() => (window as unknown as KtmWindow).__ktmDebug?.audio?.started === true, null, { timeout: 30_000 });
  const started = await page.evaluate(() => (window as unknown as KtmWindow).__ktmDebug);
  console.log(`audio ${JSON.stringify(started?.audio)} temples=${started?.temples}`);
  expect(started?.audio?.loaded).toBe(6);
  const w = started!.audio!.weights;
  expect(Math.abs(w.market! + w.traffic! + w.wind! - 1)).toBeLessThan(1e-9);

  await page.keyboard.press('KeyN');
  await page.waitForFunction(() => (window as unknown as KtmWindow).__ktmDebug?.audio?.muted === true, null, { timeout: 10_000 });
  await page.keyboard.press('KeyN');
  await page.waitForFunction(() => (window as unknown as KtmWindow).__ktmDebug?.audio?.muted === false, null, { timeout: 10_000 });
  expect(errors, 'page errors').toEqual([]);
});
