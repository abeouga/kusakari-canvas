import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = '1';
const id = process.argv.find((arg) => arg.startsWith('--garden='))?.slice('--garden='.length);
assert(id && /^[0-9a-f-]{36}$/.test(id), 'Specify the inspected garden with --garden=<UUID>');
const api = `http://127.0.0.1:8080/api/gardens/${id}`;
const before = await fetch(api).then((r) => r.json());
const browser = await chromium.launch({ channel: 'chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } }), errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // Inspection must not autosave or replace the user's thumbnail/camera view.
  await page.route('**/api/**', (route) => route.request().method() === 'GET'
    || route.request().url().endsWith('/materials/quote') ? route.continue() : route.abort('blockedbyclient'));
  await page.goto(`http://127.0.0.1:5173/gardens/${id}`);
  const loaded = `読み込み済み: ${before.objects.length} / ${before.objects.length}`;
  await expect(page.getByTestId('model-loaded')).toHaveText(loaded, { timeout: 60000 });
  await page.reload(); await expect(page.getByTestId('model-loaded')).toHaveText(loaded, { timeout: 60000 });
  await page.screenshot({ path: 'artifacts/plant-v3/current-garden-reloaded.png' });
  await page.getByTestId('garden-canvas').locator('canvas').hover(); await page.mouse.wheel(0, -180);
  await page.waitForTimeout(350);
  await page.screenshot({ path: 'artifacts/plant-v3/current-garden-close.png' });
  const after = await fetch(api).then((r) => r.json());
  assert.deepEqual(after, before); assert.equal(errors.length, 0);
  assert(after.objects.filter((o) => o.modelComposition).every((o) => o.modelComposition.version === 3));
  await writeFile('artifacts/plant-v3/current-garden-verification.json', JSON.stringify({
    id, revision: after.revision, plants: after.objects.length, allVersion3: true,
    reloaded: true, inspectionDidNotMutateGarden: true, pageErrors: errors,
  }, null, 2));
  console.log(`PASS: current garden ${after.objects.length} plants loaded after reload; no browser exceptions or inspection writes.`);
} finally { await browser.close(); }
