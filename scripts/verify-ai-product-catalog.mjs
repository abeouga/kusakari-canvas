// Read-only verification against normal data; use the existing empty cart, never create test gardens here.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

const output = resolve('D:/KusakariVerification/ai-products-20261019');
const garden = JSON.parse(await readFile(resolve(output, 'garden-before.json'), 'utf8'));
const products = JSON.parse(await readFile(resolve(output, 'product-rows-before.json'), 'utf8'))
  .filter((item) => item.active && item.id !== 'canvas-oak');
const expected = products.map((item) => item.id).sort();
const session = JSON.parse(await readFile('D:/KusakariVerification/catalog-cleanup-20261018/browser-session-private.json', 'utf8'));
process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = '1';
const browser = await chromium.launch({ channel: 'chromium' });
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  await context.addCookies([{ name: 'kusakari_cart', value: session.cartId, domain: '127.0.0.1',
    path: '/api', httpOnly: true, secure: false, sameSite: 'Strict' }]);
  await context.route('**/api/**', (route) => route.request().method() === 'GET'
    ? route.continue() : route.abort('blockedbyclient'));
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:5186/#plants');
  const cards = page.locator('.product-card');
  await expect(cards).toHaveCount(30);
  await page.reload();
  await expect(cards).toHaveCount(30);
  assert.deepEqual(await cards.evaluateAll((nodes) => nodes.map((node) => node.dataset.testid.slice('product-'.length)).sort()), expected);
  await expect(page.getByTestId('product-canvas-oak')).toHaveCount(0);
  for (let index = 0; index < 30; index++) {
    await cards.nth(index).scrollIntoViewIfNeeded();
    await expect.poll(() => cards.nth(index).locator('img').evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
  }
  await cards.first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(output, 'normal-ec-catalog.png') });
  await page.goto(`http://127.0.0.1:5173/gardens/${garden.id}`);
  await expect(page.getByTestId('model-loaded')).toHaveText(`読み込み済み: ${garden.objects.length} / ${garden.objects.length}`, { timeout: 60000 });
  await page.reload();
  await expect(page.getByTestId('model-loaded')).toHaveText(`読み込み済み: ${garden.objects.length} / ${garden.objects.length}`, { timeout: 60000 });
  const browse = page.locator('.browse-product');
  await expect(browse).toHaveCount(30);
  assert.deepEqual(await browse.evaluateAll((nodes) => nodes.map((node) => node.dataset.testid.slice('browse-'.length)).sort()), expected);
  await expect(page.getByTestId('asset-tree_oak')).toHaveCount(0);
  await expect(page.getByTestId('browse-canvas-oak')).toHaveCount(0);
  await page.screenshot({ path: resolve(output, 'normal-garden-reloaded.png') });
  const current = await page.request.get(`http://127.0.0.1:8080/api/gardens/${garden.id}`).then((response) => response.json());
  assert.deepEqual(current, garden);
  const productIds = [...new Set([...expected, ...garden.objects.map((item) => item.productId).filter(Boolean)])];
  const response = await page.request.post('http://127.0.0.1:8080/api/ai/product-references', { data: { productIds } });
  assert.equal(response.status(), 200);
  const references = await response.json();
  assert.deepEqual(references.map((item) => item.productId), productIds);
  assert(references.every((item) => !item.requiresUpload));
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'normal-ui-checks.json'), JSON.stringify({ passed: true,
    catalogProducts: 30, existingPlacements: garden.objects.length, automaticReferences: references.length,
    manualUploadsRequired: 0, legacyOakHidden: true, gardenUnchanged: true, errors }, null, 2), { flag: 'wx' });
  await writeFile(resolve(output, 'normal-reference-metadata.json'), JSON.stringify(references, null, 2), { flag: 'wx' });
  console.log(`PASS: 30 products; oak absent; ${garden.objects.length} saved placements unchanged; ${references.length} automatic references`);
} finally { await browser.close(); }
