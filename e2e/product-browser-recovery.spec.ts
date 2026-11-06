import { expect, test } from './test.js';
import { createTestProduct } from './catalog-fixture';
import { seedGardenPhoto } from './garden-photo';

test('EC接続失敗を表示し、再取得後に商品を配置・保存・復元できる', async ({ page, request }, testInfo) => {
  const api = (process.env.KUSAKARI_CANVAS_E2E_API_URL ? process.env.KUSAKARI_CANVAS_E2E_API_URL + '/api' : 'http://127.0.0.1:18081/api');
  const response = await request.post(`${api}/gardens`, { data: { name: `商品接続検証 ${Date.now()}` } });
  expect(response.ok()).toBeTruthy();
  const garden = await response.json();
  const fixtureProduct = await createTestProduct(request, '接続復旧検証用');
  // Only the failure is injected. Recovery uses the real EC API and dedicated MySQL.
  const cartUrl = ((process.env.KUSAKARI_EC_E2E_WEB_URL || 'http://127.0.0.1:15286') + '/api/cart');
  await page.route(cartUrl, (route) => route.abort('failed'));
  // 庭写真が未アップロードの庭には配置できないため、先に確定済みの写真を保存します（#15）。
  await seedGardenPhoto(page, garden.id);
  await page.goto(`/gardens/${garden.id}`);
  await page.getByRole('button', { name: '3D庭', exact: true }).click();
  const browser = page.getByRole('region', { name: 'ECの商品一覧' });
  await expect(browser.getByRole('alert')).toContainText('ECへ接続できません');
  await expect(browser.getByText('商品を読み込んでいます…')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('connection-error.png'), fullPage: true });
  await page.unroute(cartUrl);
  await browser.getByRole('button', { name: '商品を再取得' }).click();
  await expect(browser.getByRole('alert')).toHaveCount(0);
  const product = browser.getByTestId(`browse-${fixtureProduct.id}`);
  await expect(product).toBeVisible();
  // The usage hint lives behind the i mark and is drawn above every other element.
  await expect(browser.getByText('商品を庭へドラッグして配置できます。')).toHaveCount(0);
  await browser.getByRole('button', { name: '商品一覧の使い方', exact: true }).hover();
  const hint = page.getByRole('tooltip');
  await expect(hint).toHaveText('商品を庭へドラッグして配置できます。');
  expect(await hint.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
  })).toBe(true);
  await page.mouse.move(0, 0);
  await expect(hint).toHaveCount(0);
  await browser.getByRole('button', { name: '商品一覧の使い方', exact: true }).click();
  await page.mouse.move(0, 0);
  await expect(hint).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(hint).toHaveCount(0);
  // Category buttons filter the list and show which category is selected.
  const categories = browser.getByRole('group', { name: '商品カテゴリ' });
  const category = fixtureProduct.category as string;
  await categories.getByRole('button', { name: category, exact: true }).click();
  await expect(categories.getByRole('button', { name: category, exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(categories.getByRole('button', { name: 'すべて', exact: true })).toHaveAttribute('aria-pressed', 'false');
  const shown = await browser.locator('.browse-product small:first-of-type').allTextContents();
  expect(shown.length).toBeGreaterThan(0);
  expect(new Set(shown)).toEqual(new Set([category]));
  await categories.getByRole('button', { name: 'すべて', exact: true }).click();
  await browser.getByRole('searchbox', { name: '商品を検索' }).fill(fixtureProduct.name);
  await expect(product).toBeVisible();
  for (const name of await browser.locator('.browse-product strong').allTextContents()) expect(name).toContain(fixtureProduct.name);
  await browser.getByRole('searchbox', { name: '商品を検索' }).fill('');
  const canvas = page.getByTestId('garden-canvas').locator('canvas');
  await product.dragTo(canvas, { sourcePosition: { x: 35, y: 35 } });
  await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 1 / 1');
  await expect(page.getByTestId('save-status')).toHaveText('保存済み');
  const saved = await (await request.get(`${api}/gardens/${garden.id}`)).json();
  expect(saved.objects).toHaveLength(1);
  await page.reload();
  await page.getByRole('button', { name: '3D庭', exact: true }).click();
  await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 1 / 1');
  await expect(browser.locator('.browse-product').first()).toBeVisible();
  const reloaded = await (await request.get(`${api}/gardens/${garden.id}`)).json();
  expect(reloaded).toEqual(saved);
  await testInfo.attach('garden-reloaded.json', { body: JSON.stringify(reloaded), contentType: 'application/json' });
  await page.screenshot({ path: testInfo.outputPath('product-placed-reloaded.png'), fullPage: true });
});
