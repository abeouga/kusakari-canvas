import { defineConfig } from '@playwright/test';
import base from './playwright.config';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const canvasApi = process.env.KUSAKARI_CANVAS_E2E_API_URL!;
const canvasWeb = `http://127.0.0.1:${process.env.KUSAKARI_CANVAS_E2E_WEB_PORT}`;
const ecApi = `http://127.0.0.1:${process.env.KUSAKARI_EC_E2E_API_PORT}`;
const ecWeb = process.env.KUSAKARI_EC_E2E_WEB_URL!;
const ecDirectory = process.env.KUSAKARI_EC_DIRECTORY || '../kusakari-ec';
if (!ecWeb || !canvasApi) throw new Error('Run via npm run test:e2e -- --config playwright.full.config.ts');
process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = '1';
for (const [key, folder] of Object.entries({
  KUSAKARI_AUTOSAVE_EVIDENCE: 'autosave', KUSAKARI_HISTORY_GALLERY_EVIDENCE: 'history',
  KUSAKARI_AI_PRODUCTS_EVIDENCE: 'ai-products', KUSAKARI_BEFORE_AFTER_EVIDENCE: 'before-after',
})) process.env[key] = resolve('artifacts/e2e/full-suite', folder);
const servers = Array.isArray(base.webServer) ? base.webServer : [];
const javaTemp = resolve('artifacts/java-tmp');
mkdirSync(javaTemp, { recursive: true });
export default defineConfig({
  ...base,
  globalSetup: './e2e/full-setup.ts',
  timeout: 120000,
  use: { ...base.use, channel: 'chromium', actionTimeout: 15000 },
  reporter: [['list'], ['json', { outputFile: 'artifacts/e2e/full-suite/results.json' }],
    ['html', { outputFolder: 'artifacts/e2e/full-suite/report', open: 'never' }]],
  outputDir: 'artifacts/e2e/full-suite/test-results',
  webServer: [
    { ...servers[0], env: { ...servers[0].env, KUSAKARI_CANVAS_E2E_EC_URL: ecApi,
      KUSAKARI_CANVAS_E2E_EC_IMAGE_ORIGIN: ecWeb, KUSAKARI_CANVAS_E2E_OPENAI_API_KEY: ' ' } },
    { command: 'node scripts/api.mjs e2e', cwd: ecDirectory, url: `${ecApi}/api/health`,
      stdout: 'pipe',
      reuseExistingServer: false, timeout: 120000, env: {
        LOGGING_LEVEL_ROOT: 'WARN',
        JAVA_TOOL_OPTIONS: `-Xmx384m -Djdk.net.unixdomain.tmpdir=${javaTemp}`, KUSAKARI_CANVAS_API_URL: canvasApi,
        KUSAKARI_EC_E2E_API_PORT: process.env.KUSAKARI_EC_E2E_API_PORT!,
        KUSAKARI_EC_E2E_WEB_ORIGIN: ecWeb, KUSAKARI_EC_E2E_CANVAS_ORIGIN: canvasWeb } },
    { ...servers[1], env: { ...servers[1].env, VITE_KUSAKARI_EC_URL: `${ecWeb}/` } },
    { command: `npm --workspace frontend run dev -- --host 127.0.0.1 --port ${process.env.KUSAKARI_EC_E2E_WEB_PORT} --strictPort`,
      cwd: ecDirectory, url: ecWeb, reuseExistingServer: false, timeout: 60000,
      env: { KUSAKARI_EC_API_TARGET: ecApi, VITE_KUSAKARI_CANVAS_URL: `${canvasWeb}/` } },
  ],
});
