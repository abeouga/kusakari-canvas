import { defineConfig } from '@playwright/test';
import { fromRoot } from './paths.js';
import base from './playwright.plant-model.config.js';

export default defineConfig({
  ...base,
  testMatch: 'product-browser-recovery.spec.ts',
  reporter: [['list'], ['html', { outputFolder: fromRoot('artifacts/playwright-report'), open: 'never' }]],
  outputDir: fromRoot('artifacts/playwright-results'),
});
