import { defineConfig } from '@playwright/test';
import base from './playwright.plant-model.config';
export default defineConfig({ ...base, testMatch: ['plant-v3.spec.ts', 'plant-v4-interaction.spec.ts', 'plant-model-product.spec.ts', 'plant-library-v2.spec.ts'],
  reporter: [['list'], ['json', { outputFile: 'artifacts/plant-v4/e2e-results.json' }]],
  outputDir: 'artifacts/plant-v4/e2e-traces' });
