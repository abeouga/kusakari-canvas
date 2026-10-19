import { expect, test } from '@playwright/test';
import { createTestProduct } from './catalog-fixture';

test('EC接続失敗を表示し、再取得後に商品を配置・保存・復元できる', async ({ page, request }, testInfo) => {
  const api = (process.env.KUSAKARI_CANVAS_E2E_API_URL ? process.env.KUSAKARI_CANVAS_E2E_API_URL + '/api' : 'http://127.0.0.1:18081/api');
  const response = await request.post(`${api}/gardens`, { data: { name: `商品接続検証 ${Date.now()}` } });
  expect(response.ok()).toBeTruthy();
  const garden = await response.json();
  const fixtureProduct = await createTestProduct(request, '接続復旧検証用');
  // Only the failure is injected. Recovery uses the real EC API and dedicated MySQL.
  const cartUrl = ((process.env.KUSAKARI_EC_E2E_WEB_URL || 'http://127.0.0.1:15286') + '/api/cart');
  await page.route(cartUrl, (route) => route.abort('failed'));
  await page.goto(`/gardens/${garden.id}`);
  const browser = page.getByRole('region', { name: 'ECの商品一覧' });
  await expect(browser.getByRole('alert')).toContainText('ECへ接続できません');
  await expect(browser.getByText('商品を読み込んでいます…')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('connection-error.png'), fullPage: true });
  await page.unroute(cartUrl);
  await browser.getByRole('button', { name: '商品を再取得' }).click();
  await expect(browser.getByRole('alert')).toHaveCount(0);
  const product = browser.getByTestId(`browse-${fixtureProduct.id}`);
  await expect(product).toBeVisible();
  await product.getByRole('button', { name: '庭に配置', exact: true }).click();
  const canvas = page.getByTestId('garden-canvas').locator('canvas');
  const bounds = (await canvas.boundingBox())!;
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 1 / 1');
  await expect(page.getByTestId('save-status')).toHaveText('保存済み');
  const saved = await (await request.get(`${api}/gardens/${garden.id}`)).json();
  expect(saved.objects).toHaveLength(1);
  await page.reload();
  await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 1 / 1');
  await expect(browser.locator('.browse-product').first()).toBeVisible();
  const reloaded = await (await request.get(`${api}/gardens/${garden.id}`)).json();
  expect(reloaded).toEqual(saved);
  await testInfo.attach('garden-reloaded.json', { body: JSON.stringify(reloaded), contentType: 'application/json' });
  await page.screenshot({ path: testInfo.outputPath('product-placed-reloaded.png'), fullPage: true });
});
