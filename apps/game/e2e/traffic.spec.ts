import { expect, test } from '@playwright/test';

interface KtmWindow {
  __ktmReady?: boolean;
  __ktmDebug?: { trafficCount: number };
}

// The fixture world has a single road, so CI only asks for some traffic; against a real world dir set
// KTM_TRAFFIC_MIN=10 (and KTM_WORLD_DIR) to check the full density.
const MIN = Number(process.env.KTM_TRAFFIC_MIN ?? 1);
const RUN_S = Number(process.env.KTM_TRAFFIC_S ?? 20);

test('ambient traffic runs without page errors', async ({ page }) => {
  test.setTimeout(120_000 + RUN_S * 1000);
  const errors: Error[] = [];
  page.on('pageerror', (e) => { errors.push(e); });

  await page.goto('/?tile=x14_y17&traffic=1&freeze=0');
  await page.waitForFunction(() => {
    const w = window as unknown as KtmWindow;
    return w.__ktmReady === true || document.getElementById('hud')?.textContent?.startsWith('error:');
  }, null, { timeout: 120_000 });
  const hud = await page.locator('#hud').textContent();
  expect(hud?.startsWith('error:') ? hud : '', 'hud reports an error').toBe('');

  const start = Date.now();
  let count = 0;
  while (Date.now() - start < RUN_S * 1000) {
    await page.waitForTimeout(2000);
    count = await page.evaluate(() => (window as unknown as KtmWindow).__ktmDebug?.trafficCount ?? -1);
    console.log(`t=${((Date.now() - start) / 1000).toFixed(1)}s trafficCount=${count} hud="${await page.locator('#hud').textContent()}"`);
  }
  expect(errors, 'page errors').toEqual([]);
  expect(count).toBeGreaterThanOrEqual(MIN);
  expect(count).toBeLessThanOrEqual(60);
  expect(await page.locator('#hud').textContent()).toContain(`${count} vehicle`);
});
