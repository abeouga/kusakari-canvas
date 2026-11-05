import { defineConfig } from '@playwright/test';
import { fromRoot } from './paths.js';
import plantConfig from './playwright.plant-model.config.js';

export default defineConfig({
  ...plantConfig,
  testMatch: ['shopping-lists.spec.ts', 'plant-model-product.spec.ts'],
  reporter: [['list'], ['json', { outputFile: fromRoot('artifacts/e2e/shopping-lists/results.json') }],
    ['html', { outputFolder: fromRoot('artifacts/shopping-report'), open: 'never' }]],
  outputDir: fromRoot('artifacts/shopping-results'),
});
