import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const worldDir = process.env.KTM_WORLD_DIR ?? `${repo}dist/e2e-world`;
const PORT = 5175;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  outputDir: `${repo}dist/e2e-results`,
  timeout: 180_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 960, height: 540 },
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  projects: [{ name: 'chromium' }],
  webServer: {
    command: `bun --cwd ${repo}apps/game vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: { KTM_WORLD_DIR: worldDir },
  },
});
