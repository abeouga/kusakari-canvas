import { defineConfig } from '@playwright/test';

// Optional Google Fonts must not hold screenshots of already-loaded GLB models indefinitely.
process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = '1';

export default defineConfig({
  testDir: './e2e', testMatch: 'plant-model-product.spec.ts', workers: 1, timeout: 360000,
  expect: { timeout: 15000 },
  reporter: [['list'], ['json', { outputFile: 'artifacts/e2e/plant-model/results.json' }],
    ['html', { outputFolder: 'artifacts/plant-model-report', open: 'never' }]],
  outputDir: 'artifacts/plant-model-results',
  // Full Chromium uses the desktop GPU; headless-shell software rendering stalls repeated plant drops.
  use: { baseURL: 'http://127.0.0.1:15173', browserName: 'chromium', channel: 'chromium', actionTimeout: 45000, navigationTimeout: 20000, viewport: { width: 1440, height: 1000 },
    trace: { mode: 'retain-on-failure', screenshots: false, snapshots: true }, screenshot: 'only-on-failure' },
  webServer: [
    { command: 'npm run dev:api', url: 'http://127.0.0.1:18081/api/assets', reuseExistingServer: false, timeout: 120000,
      env: { KUSAKARI_CANVAS_PROFILE: 'e2e', KUSAKARI_CANVAS_PORT: '18081' } },
    { command: 'node scripts/api.mjs e2e', cwd: '../kusakari-ec', url: 'http://127.0.0.1:18186/api/health',
      reuseExistingServer: false, timeout: 90000, env: { KUSAKARI_CANVAS_API_URL: 'http://127.0.0.1:18081',
        KUSAKARI_EC_E2E_API_PORT: '18186', KUSAKARI_EC_E2E_WEB_ORIGIN: 'http://127.0.0.1:15286' } },
    { command: 'npm --workspace frontend run dev -- --host 127.0.0.1 --port 15173 --strictPort', url: 'http://127.0.0.1:15173', reuseExistingServer: false,
      env: { KUSAKARI_CANVAS_API_TARGET: 'http://127.0.0.1:18081', VITE_KUSAKARI_EC_URL: 'http://127.0.0.1:15286/' } },
    { command: 'npm --workspace frontend run dev -- --host 127.0.0.1 --port 15286 --strictPort', cwd: '../kusakari-ec', url: 'http://127.0.0.1:15286', reuseExistingServer: false,
      env: { KUSAKARI_EC_API_TARGET: 'http://127.0.0.1:18186', VITE_KUSAKARI_CANVAS_URL: 'http://127.0.0.1:15173/' } },
  ],
});
