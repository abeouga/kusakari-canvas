import { defineConfig } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import base from '../../playwright.config.js';
import { authStatePath } from '../auth-session.js';
import { fromRoot, repoRoot } from './paths.js';

const canvasApi = process.env.KUSAKARI_CANVAS_E2E_API_URL!;
const canvasWeb = `http://127.0.0.1:${process.env.KUSAKARI_CANVAS_E2E_WEB_PORT}`;
const ecApi = `http://127.0.0.1:${process.env.KUSAKARI_EC_E2E_API_PORT}`;
const ecWeb = process.env.KUSAKARI_EC_E2E_WEB_URL!;
const ecDirectory = fromRoot(process.env.KUSAKARI_EC_DIRECTORY || '../kusakari-ec');
if (!ecWeb || !canvasApi) throw new Error('Run via npm run test:e2e -- --config e2e/configs/playwright.full.config.ts');
process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = '1';
for (const [key, folder] of Object.entries({
  KUSAKARI_AUTOSAVE_EVIDENCE: 'autosave', KUSAKARI_HISTORY_GALLERY_EVIDENCE: 'history',
  KUSAKARI_AI_PRODUCTS_EVIDENCE: 'ai-products', KUSAKARI_BEFORE_AFTER_EVIDENCE: 'before-after',
})) process.env[key] = fromRoot('artifacts/e2e/full-suite', folder);
const servers = Array.isArray(base.webServer) ? base.webServer : [];
const javaTemp = fromRoot('artifacts/java-tmp');
mkdirSync(javaTemp, { recursive: true });
export default defineConfig({
  ...base,
  testDir: fromRoot('e2e'),
  globalSetup: fromRoot('e2e/full-setup.ts'),
  globalTeardown: fromRoot('e2e/full-teardown.ts'),
  timeout: 120000,
  use: { ...base.use, channel: 'chromium', actionTimeout: 15000, storageState: authStatePath },
  reporter: [['list'], ['json', { outputFile: fromRoot('artifacts/e2e/full-suite/results.json') }],
    ['html', { outputFolder: fromRoot('artifacts/e2e/full-suite/report'), open: 'never' }]],
  outputDir: fromRoot('artifacts/e2e/full-suite/test-results'),
  webServer: [
    { ...servers[0], cwd: repoRoot, env: { ...servers[0].env, KUSAKARI_CANVAS_E2E_EC_URL: ecApi,
      KUSAKARI_CANVAS_E2E_EC_IMAGE_ORIGIN: ecWeb, KUSAKARI_CANVAS_E2E_OPENAI_API_KEY: ' ',
      KUSAKARI_AUTH_MODE: 'cognito', KUSAKARI_CANVAS_AUTH_EC_URL: ecApi } },
    { command: 'node scripts/api.mjs e2e', cwd: ecDirectory, url: `${ecApi}/api/health`,
      stdout: 'pipe',
      reuseExistingServer: false, timeout: 120000, env: {
        LOGGING_LEVEL_ROOT: 'WARN',
        JAVA_TOOL_OPTIONS: `-Xmx1024m -Djdk.net.unixdomain.tmpdir=${javaTemp}`, KUSAKARI_CANVAS_API_URL: canvasApi,
        KUSAKARI_EC_E2E_API_PORT: process.env.KUSAKARI_EC_E2E_API_PORT!,
        KUSAKARI_EC_E2E_WEB_ORIGIN: ecWeb, KUSAKARI_EC_E2E_CANVAS_ORIGIN: canvasWeb } },
    { ...servers[1], cwd: repoRoot, env: { ...servers[1].env, VITE_KUSAKARI_EC_URL: `${ecWeb}/` } },
    { command: `npm --workspace frontend run dev -- --host 127.0.0.1 --port ${process.env.KUSAKARI_EC_E2E_WEB_PORT} --strictPort`,
      cwd: ecDirectory, url: ecWeb, reuseExistingServer: false, timeout: 60000,
      env: { KUSAKARI_EC_API_TARGET: ecApi, VITE_KUSAKARI_CANVAS_URL: `${canvasWeb}/` } },
  ],
});
