import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = '1';
const id = process.argv.find((arg) => arg.startsWith('--garden='))?.slice('--garden='.length);
assert(id && /^[0-9a-f-]{36}$/.test(id));
const api = `http://127.0.0.1:8080/api/gardens/${id}`;
const before = await fetch(api).then((r) => r.json()), output = 'artifacts/plant-v4';
const browser = await chromium.launch({ channel: 'chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } }), errors = [];
  let blockedThumbnailUploads = 0;
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/**', (route) => {
    const request = route.request();
    if (request.method() === 'GET' || request.url().endsWith('/materials/quote')) return route.continue();
    if (request.url().endsWith('/thumbnail')) blockedThumbnailUploads++;
    return route.abort('blockedbyclient');
  });
  await page.goto(`http://127.0.0.1:5173/gardens/${id}?renderReview`);
  const loaded = `読み込み済み: ${before.objects.length} / ${before.objects.length}`;
  await expect(page.getByTestId('model-loaded')).toHaveText(loaded, { timeout: 60000 });
  blockedThumbnailUploads = 0;
  await page.reload(); await expect(page.getByTestId('model-loaded')).toHaveText(loaded, { timeout: 60000 });
  const productCards = page.locator('.browse-product');
  await expect(productCards.first()).toBeVisible({ timeout: 20000 });
  await expect.poll(() => productCards.first().locator('img').evaluate((img) => img.complete && img.naturalWidth > 0),
    { timeout: 15000 }).toBe(true);
  // This read-only inspection blocks thumbnail writes. Wait for the three existing
  // upload attempts; each capture legitimately renders once and restores once.
  await expect.poll(() => blockedThumbnailUploads, { timeout: 15000 }).toBe(3);
  await page.waitForTimeout(500);
  // Product readiness does not imply a fully settled render tree. Record the
  // fixed warm-up window too, rather than retrying until a zero-frame sample.
  const warmup = await page.evaluate(() => globalThis.plantRenderSnapshot());
  await page.waitForTimeout(11000);
  const start = await page.evaluate(() => globalThis.plantRenderSnapshot());
  await page.waitForTimeout(15000); const end = await page.evaluate(() => globalThis.plantRenderSnapshot());
  await page.screenshot({ path: `${output}/current-garden-reloaded.png` });
  const canvas = page.getByTestId('garden-canvas').locator('canvas');
  await canvas.hover(); await page.mouse.wheel(0, -180); await page.waitForTimeout(1800);
  await page.screenshot({ path: `${output}/current-garden-close.png` });
  const after = await fetch(api).then((r) => r.json()); assert.deepEqual(after, before); assert.equal(errors.length, 0);
  const newPlants = after.objects.filter((o) => o.modelComposition?.profile.botanicalForm);
  assert(newPlants.length > 0 && newPlants.every((o) => o.modelComposition.version === 4));
  await writeFile(`${output}/current-garden-verification.json`, JSON.stringify({ id, revision: after.revision,
    plants: after.objects.length, v4Plants: newPlants.length, retainedOlderPlants: after.objects.length - newPlants.length,
    reloaded: true, inspectionDidNotMutateGarden: true, idleFrames: end.frame - start.frame,
    warmupSeconds: 11, warmupFrames: start.frame - warmup.frame, idleSeconds: 15,
    blockedThumbnailUploads, productCards: await productCards.count(), firstProductImageLoaded: true,
    renderer: end, pageErrors: errors }, null, 2));
  assert.equal(end.frame - start.frame, 0, 'Settled garden must not continuously render');
  console.log(`PASS: ${after.objects.length} plants after reload, ${newPlants.length} v4, idle frames 0, no mutation or exceptions.`);
} finally { await browser.close(); }
