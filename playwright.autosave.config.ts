import { defineConfig } from '@playwright/test';
import base from './playwright.plant-model.config';
const evidence = process.env.KUSAKARI_AUTOSAVE_EVIDENCE;
if (!evidence?.startsWith('D:/KusakariVerification/')) throw new Error('Set a dedicated D: evidence directory');
process.env.KUSAKARI_CANVAS_E2E_API_URL = 'http://127.0.0.1:18081';
const { webServer, ...shared } = base;
export default defineConfig(shared, {
  testMatch: 'editor-autosave.spec.ts', timeout: 120000,
  reporter: [['list'], ['json', { outputFile: `${evidence}/results.json` }]],
  outputDir: `${evidence}/test-results`,
  webServer: (Array.isArray(webServer) ? webServer : []).map(server => ({
    ...server, env: { ...server.env, JAVA_TOOL_OPTIONS: '-Xmx384m', KUSAKARI_CANVAS_E2E_OPENAI_API_KEY: ' ' },
  })),
});
