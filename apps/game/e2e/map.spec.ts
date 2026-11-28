import { expect, test } from '@playwright/test';

interface KtmWindow {
  __ktmReady?: boolean;
  __ktmDebug?: { mapOpen: boolean; waypoint: { x: number; z: number } | null };
}

test('minimap, map screen and waypoint', async ({ page }) => {
  const errors: Error[] = [];
  page.on('pageerror', (e) => { errors.push(e); });

  await page.goto('/?tile=x14_y17&traffic=1');
  await page.waitForFunction(() => {
    const w = window as unknown as KtmWindow;
    return w.__ktmReady === true || document.getElementById('hud')?.textContent?.startsWith('error:');
  }, null, { timeout: 120_000 });
  const hud = await page.locator('#hud').textContent();
  expect(hud?.startsWith('error:') ? hud : '', 'hud reports an error').toBe('');

  const vp = page.viewportSize()!;
  const minimap = page.locator('#minimap');
  await expect(minimap).toBeVisible();
  const box = (await minimap.boundingBox())!;
  expect(box.width).toBe(200);
  expect(box.height).toBe(200);
  expect(box.x).toBeLessThan(20);
  expect(box.y + box.height).toBeGreaterThan(vp.height - 20);

  const debug = () => page.evaluate(() => (window as unknown as KtmWindow).__ktmDebug!);
  await page.keyboard.press('m');
  await expect(page.locator('#map-screen')).toBeVisible();
  await expect.poll(async () => (await debug()).mapOpen).toBe(true);

  // A click east of the player (map centre) sets a waypoint; the HUD shows its distance.
  await page.mouse.click(vp.width / 2 + 40, vp.height / 2);
  await expect.poll(async () => (await debug()).waypoint).not.toBeNull();
  await expect(page.locator('#waypoint')).toBeVisible();
  await expect(page.locator('#waypoint')).toContainText(' m');

  await page.keyboard.press('m');
  await expect(page.locator('#map-screen')).toBeHidden();
  await expect.poll(async () => (await debug()).mapOpen).toBe(false);
  expect(errors, 'page errors').toEqual([]);
});
