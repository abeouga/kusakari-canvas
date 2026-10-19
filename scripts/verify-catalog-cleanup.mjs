// Read-only normal-data inspection. Never place test objects in the user's garden.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = '1';
const argument = process.argv.find((value) => value.startsWith('--output-dir='));
assert(argument, 'Specify the private cleanup backup directory');
const output = resolve(argument.slice('--output-dir='.length));
const images = resolve(output, `browser-${new Date().toISOString().replaceAll(':', '-')}`);
await mkdir(images);
const load = async (name) => JSON.parse(await readFile(resolve(output, name), 'utf8'));
const save = (name, data) => writeFile(resolve(output, name), JSON.stringify(data, null, 2), { flag: 'wx' });
const plan = await load('plan.json'), before = await load('garden-before.json');
const session = await load('browser-session-private.json');
const errors = [], blockedWrites = [];
const browser = await chromium.launch({ channel: 'chromium' });
try {
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  await context.addCookies([{ name: 'kusakari_cart', value: session.cartId, domain: '127.0.0.1',
    path: '/api', httpOnly: true, secure: false, sameSite: 'Strict' }]);
  await context.route('**/api/**', (route) => {
    if (route.request().method() === 'GET') return route.continue();
    blockedWrites.push(new URL(route.request().url()).pathname);
    return route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:5186/#plants');
  const cards = page.locator('.product-card');
  await expect(cards).toHaveCount(31);
  await page.reload();
  await expect(cards).toHaveCount(31);
  const ids = await cards.evaluateAll((nodes) => nodes.map((node) => node.dataset.testid.slice('product-'.length)).sort());
  assert.deepEqual(ids, plan.keepIds);
  // Exercise lazy loading for every retained thumbnail, not just the first card.
  for (let index = 0; index < 31; index++) {
    const card = cards.nth(index);
    await card.scrollIntoViewIfNeeded();
    await expect.poll(() => card.locator('img').evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
  }
  await cards.first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(images, 'ec-catalog-reloaded.png') });
  const search = page.getByRole('textbox', { name: '植物を検索' });
  await search.fill('コナラ');
  await expect(cards).toHaveCount(1);
  await expect(page.getByTestId('product-canvas-oak')).toBeVisible();
  await page.screenshot({ path: resolve(images, 'ec-retained-oak.png') });
  await page.close();

  const garden = await context.newPage();
  garden.on('pageerror', (error) => errors.push(error.message));
  const loaded = `読み込み済み: ${before.objects.length} / ${before.objects.length}`;
  await garden.goto(`http://127.0.0.1:5173/gardens/${plan.gardenId}`);
  await expect(garden.getByTestId('model-loaded')).toHaveText(loaded, { timeout: 60000 });
  await garden.reload();
  await expect(garden.getByTestId('model-loaded')).toHaveText(loaded, { timeout: 60000 });
  const browse = garden.locator('.browse-product');
  await expect(browse).toHaveCount(31);
  assert.deepEqual(await browse.evaluateAll((nodes) => nodes.map((node) => node.dataset.testid.slice('browse-'.length)).sort()), plan.keepIds);
  for (const id of plan.retireIds) await expect(garden.getByTestId(`browse-${id}`)).toHaveCount(0);
  const oak = garden.getByTestId('asset-tree_oak');
  await oak.click();
  await expect(oak).toHaveAttribute('aria-pressed', 'true');
  await garden.screenshot({ path: resolve(images, 'canvas-retained-oak.png') });
  // Sidebar intentionally owns its keyboard events; focus a canvas toolbar action.
  await garden.getByRole('button', { name: '上から見る', exact: true }).click();
  await garden.keyboard.press('Escape');
  await expect(oak).toHaveAttribute('aria-pressed', 'false');
  // Selection only: clicking the ground would modify normal user data.
  const representative = garden.getByTestId('browse-19535687-a1e1-4ac8-ad13-6c15c6fb9548').getByRole('button', { name: '庭に配置' });
  await representative.click();
  await expect(representative).toHaveAttribute('aria-pressed', 'true');
  await garden.getByRole('button', { name: '初期視点', exact: true }).click();
  await garden.keyboard.press('Escape');
  await garden.getByLabel('商品を検索', { exact: true }).fill('');
  await browse.first().scrollIntoViewIfNeeded();
  await garden.screenshot({ path: resolve(images, 'canvas-reloaded.png') });
  const response = await fetch(`http://127.0.0.1:8080/api/gardens/${plan.gardenId}`);
  assert(response.ok);
  const after = await response.json();
  assert.deepEqual(after, before);
  await save('garden-reloaded.json', after);
  assert.deepEqual(errors, []);
  assert(blockedWrites.every((path) => path.endsWith('/thumbnail')), 'Unexpected attempt to mutate normal data');
  await save('browser-result.json', { passed: true, ecProducts: 31, canvasProducts: 31, imagesLoaded: 31,
    legacyOakSelectable: true, representativeSelectable: true, loadedObjects: before.objects.length,
    reloadsVerified: true, gardenUnchanged: true, pageErrors: errors, blockedThumbnailWrites: blockedWrites.length,
    screenshotDirectory: images });
  console.log('PASS: EC/Canvas 31 products after reload, 31 images loaded, oak selectable, garden unchanged.');
} catch (error) {
  await writeFile(resolve(images, 'failure.json'), JSON.stringify({ message: error.message, pageErrors: errors }, null, 2));
  throw error;
} finally { await browser.close(); }
