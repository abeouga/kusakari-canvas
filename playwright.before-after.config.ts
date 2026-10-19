import { defineConfig } from '@playwright/test';
import base from './playwright.plant-model.config';

const evidence = process.env.KUSAKARI_BEFORE_AFTER_EVIDENCE;
if (!evidence?.startsWith('D:/KusakariVerification/')) throw new Error('Set a dedicated D: verification output directory');
process.env.KUSAKARI_CANVAS_E2E_API_URL = 'http://127.0.0.1:18081';
const { webServer, ...shared } = base;
export default defineConfig(shared, {
  testMatch: 'before-after-resolution.spec.ts',
  reporter: [['list'], ['json', { outputFile: `${evidence}/results.json` }]],
  outputDir: `${evidence}/test-results`,
  webServer: (Array.isArray(webServer) ? webServer : []).map((server, index) => ({
    ...server,
    env: { ...server.env, JAVA_TOOL_OPTIONS: '-Xmx384m', ...(index === 0 ? {
      KUSAKARI_CANVAS_E2E_OPENAI_API_KEY: ' ',
      KUSAKARI_CANVAS_E2E_EC_URL: 'http://127.0.0.1:18186',
      KUSAKARI_CANVAS_E2E_EC_IMAGE_ORIGIN: 'http://127.0.0.1:15286',
      KUSAKARI_CANVAS_AI_LIVE: '0', KUSAKARI_CANVAS_AI_QUALITY_LIVE: '0',
    } : {}) },
  })),
});
