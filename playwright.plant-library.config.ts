import { defineConfig } from '@playwright/test';
import base from './playwright.plant-model.config';
export default defineConfig({ ...base, testMatch: ['plant-library-v2.spec.ts', 'plant-model-product.spec.ts'],
  reporter: [['list'], ['json', { outputFile: 'artifacts/e2e/plant-library-v2/results.json' }]],
  outputDir: 'artifacts/plant-library-v2-results' });
