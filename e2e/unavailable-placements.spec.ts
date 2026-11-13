import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test, type APIRequestContext, type Page } from './test.js';
import { api } from './api-url.js';
import { ecSql } from './auth-session.js';
import { createTestProduct, productPlacement, showProductsTab } from './catalog-fixture.js';
import { seedGardenPhoto } from './garden-photo.js';
import type { GardenDocument } from '../frontend/src/types/garden';

// canvas#65: opening a garden looks up its placed products in the real EC (POST /api/products/references).
// Products that cannot come back (deleted, store closed or suspended, organization suspended) are removed and saved
// once by the normal autosave; temporary reasons (out of stock, hidden, ...) keep the placement.
const ec = process.env.KUSAKARI_EC_E2E_WEB_URL!;
const evidence = 'artifacts/e2e/unavailable-placements';
type Product = Parameters<typeof productPlacement>[0] & { sellerStoreName: string };

async function product(label: string): Promise<Product> {
  return createTestProduct(`E2E${label}-${randomUUID().slice(0, 8)}`);
}
async function gardenWith(page: Page, request: APIRequestContext, objects: unknown[]): Promise<GardenDocument> {
  const created = await (await request.post(`${api}/gardens`, { data: { name: `E2E 配置の整理 ${Date.now()}` } })).json();
  const photographed = await seedGardenPhoto(page, created.id);
  const saved = await request.put(`${api}/gardens/${created.id}`, { data: { ...photographed, objects } });
  expect(saved.status(), await saved.text()).toBe(200);
  return saved.json();
}
async function readGarden(request: APIRequestContext, id: string): Promise<GardenDocument> {
  return (await request.get(`${api}/gardens/${id}`)).json();
}
function uuid(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Only a newly created test product is changed.');
  return id;
}
async function open(page: Page, id: string) {
  await page.goto(`/gardens/${id}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('save-status')).toHaveText('保存済み');
}
const popup = (page: Page) => page.getByRole('dialog', { name: '庭から外した商品があります', exact: true });
const line = (page: Page, item: Product) => page.getByTestId(`shopping-line-${item.id}`);

test('a deleted product is removed with a notice; out-of-stock and hidden products stay with their store and status', async ({ page, request, seller }) => {
  await mkdir(evidence, { recursive: true });
  const [deleted, empty, hidden, normal] = [await product('削除'), await product('在庫なし'), await product('非公開'), await product('通常')];
  const garden = await gardenWith(page, request, [productPlacement(deleted, -1.5, 0), productPlacement(deleted, -0.5, 0),
    productPlacement(empty, 0.5, 0), productPlacement(hidden, 1.5, 0), productPlacement(normal, 0, 1)]);
  try {
    // While every product can be bought, the product list, the placement list and the shopping list show the store.
    await open(page, garden.id);
    await expect(popup(page)).toHaveCount(0);
    const store = normal.sellerStoreName;
    expect(store).toBeTruthy();
    await expect(line(page, normal).getByTestId('store-name')).toHaveText(store);
    await expect(line(page, normal).getByTestId('availability')).toHaveCount(0);
    await showProductsTab(page);
    await page.getByLabel('商品を検索', { exact: true }).fill(normal.name);
    await expect(page.getByTestId(`browse-${normal.id}`).getByTestId('browse-store')).toHaveText(store);
    await expect(page.locator('[data-testid^="object-row-"]')).toHaveCount(5);
    for (const row of await page.getByTestId('placed-store').all()) await expect(row).toHaveText(store);

    // The seller deletes one product in the EC; stock 0 and hidden are set in the dedicated EC database.
    expect((await seller.delete(`${ec}/api/products/${deleted.id}`)).ok()).toBeTruthy();
    ecSql(`UPDATE inventory SET quantity=0 WHERE product_id='${uuid(empty.id)}';
      UPDATE inventory SET publication_status='HIDDEN' WHERE product_id='${uuid(hidden.id)}';`);
    await open(page, garden.id);
    await expect(popup(page).getByTestId('removed-placements'))
      .toHaveText(`${deleted.name}の商品は購入できなくなったため、庭から外しました。`);
    await page.screenshot({ path: `${evidence}/removed-notice.png` });
    await popup(page).getByRole('button', { name: 'OK', exact: true }).click();
    await expect(popup(page)).toHaveCount(0);
    await expect(page.getByTestId('save-status')).toHaveText('保存済み');
    const saved = await readGarden(request, garden.id);
    expect(saved.revision).toBe(garden.revision + 1);
    expect(saved.objects.map((object) => object.productId).sort()).toEqual([empty.id, hidden.id, normal.id].sort());
    await expect(line(page, deleted)).toHaveCount(0);
    await expect(line(page, empty).getByTestId('availability')).toHaveText('在庫なし');
    await expect(line(page, empty).getByTestId('store-name')).toHaveText(store);
    await expect(line(page, hidden).getByTestId('availability')).toHaveText('現在は購入できません');
    await expect(line(page, normal).getByTestId('availability')).toHaveCount(0);

    // After reload the removal stays saved, nothing more is removed and no notice appears again.
    await open(page, garden.id);
    await expect(line(page, empty).getByTestId('availability')).toHaveText('在庫なし');
    await expect(popup(page)).toHaveCount(0);
    await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 3 / 3');
    expect(await readGarden(request, garden.id)).toEqual(saved);
    await page.screenshot({ path: `${evidence}/after-reload.png` });
    await writeFile(`${evidence}/garden-after-removal.json`, JSON.stringify(saved, null, 2));
  } finally {
    await request.delete(`${api}/gardens/${garden.id}`);
    for (const item of [empty, hidden, normal]) await seller.delete(`${ec}/api/products/${item.id}`);
  }
});

test('a product of a suspended store is removed; a legacy placement without a product stays', async ({ page, request, seller }) => {
  await mkdir(evidence, { recursive: true });
  const suspended = await product('店舗停止');
  const legacy = { id: randomUUID(), assetId: 'bench_wood', position: { x: 1, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } };
  const garden = await gardenWith(page, request, [productPlacement(suspended, -1, 0), legacy]);
  try {
    ecSql('UPDATE stores SET suspended=TRUE WHERE id=1;');
    await open(page, garden.id);
    await expect(popup(page).getByTestId('removed-placements'))
      .toHaveText(`${suspended.name}の商品は購入できなくなったため、庭から外しました。`);
    await popup(page).getByRole('button', { name: 'OK', exact: true }).click();
    await expect(page.getByTestId('save-status')).toHaveText('保存済み');
    await expect.poll(async () => (await readGarden(request, garden.id)).objects.map((object) => object.id)).toEqual([legacy.id]);
    await open(page, garden.id);
    await expect(popup(page)).toHaveCount(0);
    const saved = await readGarden(request, garden.id);
    expect(saved.objects.map((object) => object.id)).toEqual([legacy.id]);
    await page.screenshot({ path: `${evidence}/store-suspended-after-reload.png` });
    await writeFile(`${evidence}/garden-store-suspended.json`, JSON.stringify(saved, null, 2));
  } finally {
    ecSql('UPDATE stores SET suspended=FALSE WHERE id=1;');
    await request.delete(`${api}/gardens/${garden.id}`);
    await seller.delete(`${ec}/api/products/${suspended.id}`);
  }
});

// Fault injection only: the EC lookup is cut off, so Canvas cannot tell whether the product is gone and keeps it.
test('when the EC lookup fails, placements are kept; the next successful open removes them', async ({ page, request, seller }) => {
  await mkdir(evidence, { recursive: true });
  const deleted = await product('照会失敗');
  const garden = await gardenWith(page, request, [productPlacement(deleted)]);
  try {
    expect((await seller.delete(`${ec}/api/products/${deleted.id}`)).ok()).toBeTruthy();
    await page.route('**/api/products/references', (route) => route.abort('connectionrefused'));
    const lookup = page.waitForEvent('requestfailed', (failed) => failed.url().endsWith('/api/products/references'));
    await open(page, garden.id);
    await lookup;
    await expect(line(page, deleted)).toContainText('現在は販売されていないため購入できません。');
    await page.waitForTimeout(1500);
    await expect(popup(page)).toHaveCount(0);
    await expect(page.getByTestId('save-status')).toHaveText('保存済み');
    expect(await readGarden(request, garden.id)).toEqual(garden);
    await page.unroute('**/api/products/references');
    await open(page, garden.id);
    await expect(popup(page)).toBeVisible();
    await expect.poll(async () => (await readGarden(request, garden.id)).objects).toEqual([]);
  } finally {
    await request.delete(`${api}/gardens/${garden.id}`);
  }
});
