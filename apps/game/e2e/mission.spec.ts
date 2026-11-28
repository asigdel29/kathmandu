import { expect, test } from '@playwright/test';

interface KtmWindow {
  __ktmReady?: boolean;
  __ktmDebug?: { speed: number; driving: string | null; mission: { id: string; status: string; step: number; markers: number } | null };
}

// Debug run of the Thamel fare: the page spawns at Thamel Chowk in a taxi and accepts the mission at ready.
// The pickup sits on the spawn point, so the first ticks complete it (the taxi is still below stopping speed)
// and the mission moves on to step 2, the drive to Patan Durbar Square. In CI the fixture world holds only
// x14_y17, so Thamel itself has no geometry; the mission logic runs on horizontal position either way.
test('a debug mission reaches step 2 without page errors', async ({ page }) => {
  const errors: Error[] = [];
  page.on('pageerror', (e) => { errors.push(e); });

  await page.goto('/?mission=thamel-to-patan&autodrive=1&traffic=0');
  await page.waitForFunction(() => {
    const w = window as unknown as KtmWindow;
    return w.__ktmReady === true || document.getElementById('hud')?.textContent?.startsWith('error:');
  }, null, { timeout: 120_000 });
  const hud = await page.locator('#hud').textContent();
  expect(hud?.startsWith('error:') ? hud : '', 'hud reports an error').toBe('');

  const start = Date.now();
  let debug: KtmWindow['__ktmDebug'];
  for (;;) {
    debug = await page.evaluate(() => (window as unknown as KtmWindow).__ktmDebug);
    const text = await page.locator('#mission').textContent();
    console.log(`t=${((Date.now() - start) / 1000).toFixed(1)}s mission=${JSON.stringify(debug?.mission)} speed=${debug?.speed.toFixed(2)} hud="${text?.replace(/\n/g, ' | ')}"`);
    if ((debug?.mission?.step ?? -1) >= 1 || Date.now() - start > 10_000) break;
    await page.waitForTimeout(250);
  }
  expect(debug?.mission).toMatchObject({ id: 'thamel-to-patan', status: 'active', step: 1, markers: 1 });
  expect(debug?.driving).toBe('taxi');
  await expect(page.locator('#mission')).toContainText('Drop the fare at Patan Durbar Square');
  await expect(page.locator('#mission')).toContainText(/\d\.\d km/);
  if (process.env.KTM_SHOT) await page.screenshot({ path: process.env.KTM_SHOT });
  expect(errors, 'page errors').toEqual([]);
});
