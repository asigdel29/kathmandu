import { expect, test } from '@playwright/test';

interface KtmWindow {
  __ktmReady?: boolean;
  __ktmDebug?: { speed: number; speedKmh: number; driving: string | null; vehicles: number };
}

test('taxi drives off under autodrive', async ({ page }) => {
  const errors: Error[] = [];
  page.on('pageerror', (e) => { errors.push(e); });

  // A physics test: ambient traffic stays off so nothing else is on the road.
  await page.goto('/?tile=x14_y17&vehicle=taxi&autodrive=1&traffic=0');
  await page.waitForFunction(() => {
    const w = window as unknown as KtmWindow;
    return w.__ktmReady === true || document.getElementById('hud')?.textContent?.startsWith('error:');
  }, null, { timeout: 120_000 });
  const hud = await page.locator('#hud').textContent();
  expect(hud?.startsWith('error:') ? hud : '', 'hud reports an error').toBe('');
  expect(errors, 'page errors before ready').toEqual([]);

  // Poll for up to 20 s (a loaded CI runner stalls the first frames for several seconds), logging the debug state and HUD each time so a CI failure shows how far the taxi got.
  const start = Date.now();
  let debug: KtmWindow['__ktmDebug'];
  for (;;) {
    debug = await page.evaluate(() => (window as unknown as KtmWindow).__ktmDebug);
    const hudNow = await page.locator('#hud').textContent();
    console.log(`t=${((Date.now() - start) / 1000).toFixed(1)}s speed=${debug?.speed.toFixed(2)} m/s hud="${hudNow}"`);
    if ((debug?.speed ?? 0) >= 10 || Date.now() - start > 20_000) break;
    await page.waitForTimeout(250);
  }
  expect(debug?.speed ?? 0, 'taxi speed (m/s) within 20 s of ready').toBeGreaterThanOrEqual(10);
  expect(debug?.driving).toBe('taxi');
  expect(errors, 'page errors').toEqual([]);
});
