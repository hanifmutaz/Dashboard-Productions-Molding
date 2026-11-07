import { defineConfig, devices } from '@playwright/test';

/* Visual parity: production web build served by `vite preview`, API responses stubbed per test via page.route
 * (stubs live only in tests/ and never in the production bundle). */
export default defineConfig({
  testDir: 'tests/visual',
  snapshotPathTemplate: '{testDir}/__baseline__/{projectName}/{arg}{ext}',
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01 } },
  use: { baseURL: 'http://127.0.0.1:4173', timezoneId: 'Asia/Jakarta', locale: 'en-US' },
  webServer: { command: 'npm run preview -w @mpd/web -- --port 4173 --strictPort', url: 'http://127.0.0.1:4173', reuseExistingServer: true },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 900 } } },
    { name: 'ipad-webkit', use: { ...devices['iPad (gen 7) landscape'], viewport: { width: 1024, height: 768 } } },
  ],
});
