import { defineConfig } from '@playwright/test';
import { fromRoot } from './paths.js';
import base from './playwright.plant-model.config.js';
export default defineConfig({ ...base, testMatch: ['plant-library-v2.spec.ts', 'plant-model-product.spec.ts'],
  reporter: [['list'], ['json', { outputFile: fromRoot('artifacts/e2e/plant-library-v2/results.json') }]],
  outputDir: fromRoot('artifacts/plant-library-v2-results') });
