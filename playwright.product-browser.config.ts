import { defineConfig } from '@playwright/test';
import base from './playwright.plant-model.config';

export default defineConfig({
  ...base,
  testMatch: 'product-browser-recovery.spec.ts',
  webServer: (Array.isArray(base.webServer) ? base.webServer : [])
    .map((server) => ({ ...server, ...(server.cwd ? { cwd: '../kusakari-mvp' } : {}) })),
  reporter: [['list'], ['html', { outputFolder: 'artifacts/playwright-report', open: 'never' }]],
  outputDir: 'artifacts/playwright-results',
});
