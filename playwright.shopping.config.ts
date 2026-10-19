import { defineConfig } from '@playwright/test';
import plantConfig from './playwright.plant-model.config';

export default defineConfig({
  ...plantConfig,
  testMatch: ['shopping-lists.spec.ts', 'plant-model-product.spec.ts'],
  reporter: [['list'], ['json', { outputFile: 'artifacts/e2e/shopping-lists/results.json' }],
    ['html', { outputFolder: 'artifacts/shopping-report', open: 'never' }]],
  outputDir: 'artifacts/shopping-results',
});
