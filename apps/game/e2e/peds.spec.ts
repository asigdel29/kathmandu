import { expect, test } from '@playwright/test';

interface KtmWindow {
  __ktmReady?: boolean;
  __ktmDebug?: { pedCount: number };
}

// The fixture world has a single road, so CI only asks for some people; against a real world dir set
// KTM_PEDS_MIN=30 (and KTM_WORLD_DIR) to check the full density. KTM_PEDS_SHOT=<path> saves a screenshot at the end.
const MIN = Number(process.env.KTM_PEDS_MIN ?? 1);
const RUN_S = Number(process.env.KTM_PEDS_S ?? 20);
const QUERY = process.env.KTM_PEDS_QUERY ?? '';

async function ready(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(() => {
    const w = window as unknown as KtmWindow;
    return w.__ktmReady === true || document.getElementById('hud')?.textContent?.startsWith('error:');
  }, null, { timeout: 120_000 });
  const hud = await page.locator('#hud').textContent();
  expect(hud?.startsWith('error:') ? hud : '', 'hud reports an error').toBe('');
}

test('pedestrians walk without page errors', async ({ page }) => {
  test.setTimeout(120_000 + RUN_S * 1000);
  const errors: Error[] = [];
  page.on('pageerror', (e) => { errors.push(e); });

  await page.goto(`/?tile=x14_y17&freeze=0${QUERY}`);
  await ready(page);

  const start = Date.now();
  let count = 0; let max = 0;
  while (Date.now() - start < RUN_S * 1000) {
    await page.waitForTimeout(2000);
    count = await page.evaluate(() => (window as unknown as KtmWindow).__ktmDebug?.pedCount ?? -1);
    max = Math.max(max, count);
    console.log(`t=${((Date.now() - start) / 1000).toFixed(1)}s pedCount=${count}`);
  }
  if (process.env.KTM_PEDS_SHOT) await page.screenshot({ path: process.env.KTM_PEDS_SHOT });
  expect(errors, 'page errors').toEqual([]);
  expect(count).toBeGreaterThanOrEqual(MIN);
  expect(max).toBeLessThanOrEqual(120);
});

test('peds=0 disables pedestrians', async ({ page }) => {
  const errors: Error[] = [];
  page.on('pageerror', (e) => { errors.push(e); });
  await page.goto('/?tile=x14_y17&freeze=0&peds=0');
  await ready(page);
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => (window as unknown as KtmWindow).__ktmDebug?.pedCount)).toBe(0);
  expect(errors, 'page errors').toEqual([]);
});
