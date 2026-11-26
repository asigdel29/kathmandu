import { expect, test } from '@playwright/test';

interface KtmWindow {
  __ktmReady?: boolean;
  __ktmDebug?: { speed: number; speedKmh: number; driving: string | null; vehicles: number };
}

test('taxi drives off under autodrive', async ({ page }) => {
  const errors: Error[] = [];
  page.on('pageerror', (e) => { errors.push(e); });

  await page.goto('/?tile=x14_y17&vehicle=taxi&autodrive=1');
  await page.waitForFunction(() => {
    const w = window as unknown as KtmWindow;
    return w.__ktmReady === true || document.getElementById('hud')?.textContent?.startsWith('error:');
  }, null, { timeout: 120_000 });
  const hud = await page.locator('#hud').textContent();
  expect(hud?.startsWith('error:') ? hud : '', 'hud reports an error').toBe('');
  expect(errors, 'page errors before ready').toEqual([]);

  await page.waitForFunction(() => ((window as unknown as KtmWindow).__ktmDebug?.speed ?? 0) >= 10, null, { timeout: 6000 });
  const debug = await page.evaluate(() => (window as unknown as KtmWindow).__ktmDebug);
  expect(debug?.driving).toBe('taxi');
  expect(errors, 'page errors').toEqual([]);
});
