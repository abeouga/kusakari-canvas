import { defineConfig, devices } from '@playwright/test';

function getPort(name: string) {
  const value = Number(process.env[name]);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error('E2Eは npm run test:e2e から起動してください。');
  }
  return value;
}

const e2eApiPort = getPort('KUSAKARI_CANVAS_E2E_API_PORT');
const e2eWebPort = getPort('KUSAKARI_CANVAS_E2E_WEB_PORT');

const e2eApiUrl = `http://127.0.0.1:${e2eApiPort}`;
const e2eWebUrl = `http://127.0.0.1:${e2eWebPort}`;
let webCommand = `npm --workspace frontend run dev -- --host 127.0.0.1 --port ${e2eWebPort} --strictPort`;
// Paid evaluation uses a saved build so editor changes cannot reload the browser mid-generation.
if (process.env.KUSAKARI_CANVAS_E2E_PREVIEW === '1') {
  webCommand = `npm --workspace frontend exec -- vite preview --host 127.0.0.1 --port ${e2eWebPort} --strictPort --outDir ../artifacts/e2e/preview-web`;
}
let reportDirectory = 'artifacts/playwright-report';
let resultDirectory = 'artifacts/playwright-results';
const qualityRun = process.env.KUSAKARI_CANVAS_AI_QUALITY_RUN;
if (process.env.KUSAKARI_CANVAS_AI_LIVE === '1' && qualityRun) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(qualityRun)) throw new Error('Invalid quality run name.');
  reportDirectory = `artifacts/e2e/ai-quality/${qualityRun}-report`;
  resultDirectory = `artifacts/e2e/ai-quality/${qualityRun}-results`;
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: reportDirectory, open: 'never' }],
  ],
  outputDir: resultDirectory,
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 960 },
    baseURL: e2eWebUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'npm run dev:api',
      url: `${e2eApiUrl}/api/assets`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        KUSAKARI_CANVAS_PROFILE: 'e2e',
        KUSAKARI_CANVAS_HOST: '127.0.0.1',
        KUSAKARI_CANVAS_PORT: String(e2eApiPort),
      },
    },
    {
      command: webCommand,
      url: e2eWebUrl,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { KUSAKARI_CANVAS_API_TARGET: e2eApiUrl, VITE_KUSAKARI_EC_URL: 'http://127.0.0.1:15186/' },
    },
  ],
});
