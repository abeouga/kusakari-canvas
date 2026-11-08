import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { test, expect } from './test.js';
import { api } from './api-url';
import { createTestProduct, productPlacement } from './catalog-fixture';

const evidence = 'artifacts/e2e/shopping-list-counts';

// issue #40: 買い物リストが左・初期表示で、各カードの「配置数/必要数」が配置・削除・必要数変更・再読み込みで正しい。
test('shopping list opens first and shows placed/needed counts that survive reload', async ({ page, request }) => {
  await mkdir(evidence, { recursive: true });
  const product = await createTestProduct(request, 'E2E配置数-' + randomUUID().slice(0, 8));
  const created = await request.post(`${api}/gardens`, { data: { name: `配置数検証-${randomUUID().slice(0, 8)}` } });
  expect(created.status()).toBe(201);
  const garden = await created.json();
  const read = async () => request.get(`${api}/gardens/${garden.id}`).then((r) => r.json());
  try {
    const seeded = await request.put(`${api}/gardens/${garden.id}`, { data: { ...garden,
      objects: [productPlacement(product, -1, 0), productPlacement(product, 1, 0)] } });
    expect(seeded.status(), await seeded.text()).toBe(200);
    await page.goto(`/gardens/${garden.id}`);
    await page.getByRole('button', { name: '3D庭', exact: true }).click();
    const tabs = page.getByRole('tablist', { name: '商品一覧と買い物リストの切替' }).getByRole('tab');
    await expect(tabs).toHaveText(['買い物リスト（2）', '商品一覧']);
    await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel', { name: /買い物リスト/ })).toBeVisible();

    const line = page.getByTestId(`shopping-line-${product.id}`);
    const count = line.getByTestId('placement-count');
    await expect(count).toHaveText('2/2');
    await line.getByRole('button', { name: '必要数を増やす', exact: true }).click();
    await expect(count).toHaveText('2/3');
    await expect(page.getByTestId('save-status')).toHaveText('保存済み');
    expect((await read()).shoppingTargets).toEqual([{ key: `product:${product.id}`, quantity: 3 }]);

    const canvas = page.getByTestId('garden-canvas').locator('canvas');
    const bounds = (await canvas.boundingBox())!;
    await line.dragTo(canvas, { sourcePosition: { x: 35, y: 35 }, targetPosition: { x: bounds.width * 0.6, y: bounds.height * 0.55 } });
    await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 3 / 3');
    await expect(count).toHaveText('3/3');
    await page.getByTestId('object-toolbar').getByRole('button', { name: '削除', exact: true }).click();
    await expect(count).toHaveText('2/3');
    await expect(page.getByTestId('save-status')).toHaveText('保存済み');
    await expect.poll(async () => (await read()).objects.length).toBe(2);

    await page.reload();
    await expect(page.getByTestId('save-status')).toHaveText('保存済み');
    await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
    await expect(count).toHaveText('2/3');
    await expect(count).toHaveAttribute('aria-label', '配置数2 / 必要数3');
    await page.screenshot({ path: `${evidence}/after-reload.png` });
    const saved = await read();
    expect(saved.shoppingTargets).toEqual([{ key: `product:${product.id}`, quantity: 3 }]);
    await writeFile(`${evidence}/garden.json`, JSON.stringify(saved, null, 2));
  } finally {
    await request.delete(`${api}/gardens/${garden.id}`);
    await request.delete(`${process.env.KUSAKARI_EC_E2E_WEB_URL}/api/products/${product.id}`);
  }
});
