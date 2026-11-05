import { defineConfig } from '@playwright/test';
import { fromRoot } from './paths.js';
import base from './playwright.plant-model.config.js';
export default defineConfig({ ...base, testMatch: ['plant-v3.spec.ts', 'plant-model-product.spec.ts', 'plant-library-v2.spec.ts'],
  reporter: [['list'], ['json', { outputFile: fromRoot('artifacts/plant-v3/e2e-results.json') }]],
  outputDir: fromRoot('artifacts/plant-v3/e2e-traces') });
