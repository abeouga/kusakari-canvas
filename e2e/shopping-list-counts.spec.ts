import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { test, expect } from './test.js';
import { api } from './api-url';
import { createTestProduct, productPlacement } from './catalog-fixture';
import { seedGardenPhoto } from './garden-photo';

const evidence = 'artifacts/e2e/shopping-list-counts';
const ec = process.env.KUSAKARI_EC_E2E_WEB_URL || 'http://127.0.0.1:15286';

// issue #54: 買い物リストのカードに −/＋（必要数）はなく、右上の丸囲み数字が庭に設置した数を配置・削除・再読み込み後も示す。
test('shopping list cards show the placed count as a circled badge without needed-count buttons', async ({ page, request }) => {
  await mkdir(evidence, { recursive: true });
  const product = await createTestProduct(request, 'E2E設置数-' + randomUUID().slice(0, 8));
  const ecOnly = await createTestProduct(request, 'E2E未設置-' + randomUUID().slice(0, 8));
  const created = await request.post(`${api}/gardens`, { data: { name: `設置数検証-${randomUUID().slice(0, 8)}` } });
  expect(created.status()).toBe(201);
  const garden = await created.json();
  const read = async () => request.get(`${api}/gardens/${garden.id}`).then((r) => r.json());
  // issue #40で保存された必要数を持つ既存の庭として用意し、読み込み・保存で壊れないことも確かめる。
  const legacyTargets = [{ key: `product:${product.id}`, quantity: 5 }];
  try {
    const withPhoto = await seedGardenPhoto(page, garden.id);
    const seeded = await request.put(`${api}/gardens/${garden.id}`, { data: { ...withPhoto, shoppingTargets: legacyTargets,
      objects: [productPlacement(product, -1, 0), productPlacement(product, 1, 0)] } });
    expect(seeded.status(), await seeded.text()).toBe(200);
    await page.goto(`/gardens/${garden.id}`);
    const added = await page.request.put(`${ec}/api/shopping-lists/${garden.id}/items/${ecOnly.id}`);
    expect(added.status(), await added.text()).toBe(200);
    await page.reload();
    await page.getByRole('button', { name: '3D庭', exact: true }).click();
    const panel = page.getByRole('tabpanel', { name: /買い物リスト/ });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('button', { name: /必要数/ })).toHaveCount(0);
    await expect(panel).not.toContainText('必要数');

    const line = page.getByTestId(`shopping-line-${product.id}`);
    const badge = line.getByTestId('placement-count');
    await expect(badge).toHaveText('2');
    await expect(badge).toHaveAttribute('aria-label', '庭に設置した数 2');
    const card = (await line.boundingBox())!;
    const mark = (await badge.boundingBox())!;
    expect(mark.x + mark.width).toBeGreaterThan(card.x + card.width - 20);
    expect(mark.y).toBeLessThan(card.y + 20);
    expect(Math.abs(mark.width - mark.height)).toBeLessThan(1);

    const unplaced = page.getByTestId(`shopping-line-${ecOnly.id}`);
    await expect(unplaced.getByTestId('unplaced-ec-item')).toBeVisible();
    await expect(unplaced.getByTestId('placement-count')).toHaveCount(0);

    const canvas = page.getByTestId('garden-canvas').locator('canvas');
    const bounds = (await canvas.boundingBox())!;
    await line.dragTo(canvas, { sourcePosition: { x: 35, y: 35 }, targetPosition: { x: bounds.width * 0.6, y: bounds.height * 0.55 } });
    await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 3 / 3');
    await expect(badge).toHaveText('3');
    await expect(page.getByTestId('save-status')).toHaveText('保存済み');
    await page.screenshot({ path: `${evidence}/after-add.png` });
    await page.getByTestId('object-toolbar').getByRole('button', { name: '削除', exact: true }).click();
    await expect(badge).toHaveText('2');
    await expect(page.getByTestId('save-status')).toHaveText('保存済み');
    await expect.poll(async () => (await read()).objects.length).toBe(2);

    await page.reload();
    await expect(page.getByTestId('save-status')).toHaveText('保存済み');
    await expect(badge).toHaveText('2');
    await expect(unplaced.getByTestId('placement-count')).toHaveCount(0);
    await line.screenshot({ path: `${evidence}/card-badge.png` });
    await page.screenshot({ path: `${evidence}/after-reload.png` });
    const saved = await read();
    expect(saved.objects.filter((o: { productId?: string }) => o.productId === product.id)).toHaveLength(2);
    expect(saved.shoppingTargets).toEqual(legacyTargets);
    await writeFile(`${evidence}/garden.json`, JSON.stringify(saved, null, 2));
  } finally {
    await request.delete(`${api}/gardens/${garden.id}`);
    await request.delete(`${ec}/api/products/${product.id}`);
    await request.delete(`${ec}/api/products/${ecOnly.id}`);
  }
});
