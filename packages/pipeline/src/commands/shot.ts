import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { PATHS } from '../paths.ts';

export async function run(args: string[]): Promise<void> {
  const id = args[0]; if (!id) throw new Error('usage: shot <tile> [--views iso,street] [--base http://localhost:5173] [--t 15:30]');
  const views = (args.includes('--views') ? args[args.indexOf('--views') + 1]! : 'iso,street').split(',');
  const base = args.includes('--base') ? args[args.indexOf('--base') + 1]! : 'http://localhost:5173';
  const time = args.includes('--t') ? args[args.indexOf('--t') + 1]! : '15:30';
  if (!/^\d{1,2}:\d{2}$/.test(time)) throw new Error(`--t must be HH:MM, got ${time}`);
  mkdirSync(PATHS.shots, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors: Error[] = [];
  page.on('pageerror', (e) => { errors.push(e); });
  try {
    for (const view of views) {
      await page.goto(`${base}/?tile=${id}&view=${view}&t=${time}&freeze=1`);
      await page.waitForFunction(() => {
        const w = window as unknown as { __ktmReady?: boolean };
        return w.__ktmReady === true || document.getElementById('hud')?.textContent?.startsWith('error:');
      }, null, { timeout: 180_000 });
      await page.waitForTimeout(2000);
      if (errors.length) throw errors[0];
      const path = `${PATHS.shots}/${id}-${view}.png`;
      await page.screenshot({ path });
      console.log(`shot: ${path}`);
    }
  } finally {
    await browser.close();
  }
}
