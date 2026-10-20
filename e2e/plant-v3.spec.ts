import { openPlantSettings, publishProduct } from './seller-wizard';
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { plantPresetsV3, referenceProfiles } from '../scripts/plant-library-v3-presets.mjs';
import { productInput } from '../scripts/plant-library-presets.mjs';
import type { GardenDocument, PlantComposition } from '../frontend/src/types/garden';

const ec = (process.env.KUSAKARI_EC_E2E_WEB_URL || 'http://127.0.0.1:15286'), api = (process.env.KUSAKARI_CANVAS_E2E_API_URL ? process.env.KUSAKARI_CANVAS_E2E_API_URL + '/api' : 'http://127.0.0.1:18081/api'), evidence = 'artifacts/plant-v4/e2e';
type Product = { id: string; name: string; canvasMaterialCode: string; modelComposition: PlantComposition };

test('effective seller controls and current preview persist through the real EC API', async ({ page, request }) => {
  await mkdir(evidence, { recursive: true }); let productId: string | undefined;
  try {
    await page.goto(`${ec}/seller/products/new`);
    const form = page.locator('.product-form');
    await form.getByLabel('商品名', { exact: true }).fill('V3設定検証');
    await form.getByLabel('商品番号', { exact: true }).fill(`V3-${randomUUID().slice(0, 12)}`);
    await form.getByLabel('商品説明', { exact: true }).fill('専用DBの検証用データ');
    await form.getByLabel('選択店舗の在庫', { exact: true }).fill('10'); await openPlantSettings(form, '60');
    await form.getByRole('combobox', { name: '植物タイプ', exact: true }).selectOption('grass');
    await expect(form.locator('[name="modelCrownShape"]')).toBeHidden();
    await expect(form.getByLabel('根元の太さ（cm）', { exact: true })).toBeHidden();
    await expect(form.getByLabel('枝の角度（度）', { exact: true })).toBeHidden();
    await form.getByLabel('植物の幅（cm）', { exact: true }).fill('70');
    await form.getByLabel('葉の大きさ（cm）', { exact: true }).fill('25');
    await form.getByRole('slider', { name: '葉の密度', exact: true }).focus();
    await form.getByRole('slider', { name: '葉の密度', exact: true }).press('End');
    await form.getByRole('button', { name: '植物のプレビューを確認' }).click();
    await page.locator('iframe[title="植物の3Dプレビュー"]').scrollIntoViewIfNeeded();
    await expect(page.frameLocator('iframe[title="植物の3Dプレビュー"]').getByTestId('preview-loaded')).toHaveText('loaded', { timeout: 60000 });
    const saving = page.waitForResponse((r) => r.url().endsWith('/api/products') && r.request().method() === 'POST');
    await publishProduct(form);
    const response = await saving; expect(response.status(), await response.text()).toBe(200);
    const saved = await response.json(); productId = saved.id;
    expect(saved.modelComposition.version).toBe(4); expect(saved.modelComposition.fitScale).toEqual([1, 1, 1]);
    expect(saved.plantModelProfile.leafSizeCm).toBe(25);
    await page.reload();
    const products = await request.get(`${ec}/api/products?storeId=1`).then((r) => r.json());
    expect(products.find((p: Product) => p.id === productId).modelComposition).toEqual(saved.modelComposition);
    await page.screenshot({ path: `${evidence}/seller-reloaded.png` });
    await writeFile(`${evidence}/seller-product.json`, JSON.stringify(saved, null, 2));
  } finally { if (productId) expect((await request.delete(`${ec}/api/products/${productId}`)).ok()).toBeTruthy(); }
});

test('five natural models, v1/v2/v3 snapshots, placement, edits and reload retain canonical geometry', async ({ page, request }) => {
  await mkdir(evidence, { recursive: true }); const products: Product[] = [];
  let garden: GardenDocument | undefined; const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    for (const preset of plantPresetsV3.filter((p) => Object.hasOwn(referenceProfiles, String(p.key)))) {
      const response = await request.post(`${ec}/api/products`, { data: { ...productInput(preset, preset.imageUrl),
        sku: `V3-${randomUUID().slice(0, 12)}`, name: `V3検証-${preset.name}` } });
      expect(response.status(), await response.text()).toBe(200);
      const product = await response.json(); products.push(product);
      expect(product.modelComposition.version).toBe(4);
    }
    const created = await request.post(`${api}/gardens`, { data: { name: `V3形状検証-${randomUUID().slice(0, 8)}`, width: 12, depth: 10 } });
    expect(created.status()).toBe(201); garden = await created.json();
    if (!garden) throw new Error('Missing garden');
    const v1 = JSON.parse(await readFile('e2e/fixtures/plant-composition-v1.json', 'utf8'));
    const resolved = await request.post(`${api}/model-assemblies/resolve?version=2`, { data: plantPresetsV3[0].profile });
    expect(resolved.status()).toBe(200); const v2 = await resolved.json();
    expect(v2.version).toBe(2);
    const resolved3 = await request.post(`${api}/model-assemblies/resolve?version=3`, { data: plantPresetsV3[0].profile });
    expect(resolved3.status()).toBe(200); const v3 = await resolved3.json(); expect(v3.version).toBe(3);
    garden.objects = products.map((p, i) => ({ id: randomUUID(), assetId: 'plant_modular', productId: p.id,
      productName: p.name, materialCode: p.canvasMaterialCode, modelComposition: p.modelComposition,
      position: { x: (i % 3 - 1) * 3, y: 0, z: (Math.floor(i / 3) - 0.5) * 3 },
      rotation: { x: 0, y: i * 0.35, z: 0 }, scale: { x: 1, y: 1, z: 1 } }));
    for (const [i, model] of [v1, v2, v3].entries()) garden.objects.push({ id: randomUUID(), assetId: 'plant_modular',
      productId: `v3-legacy-${i}`, productName: `保存互換v${i + 1}`, materialCode: `product.v3-legacy-${i}`,
      modelComposition: model, position: { x: -4 + i * 4, y: 0, z: 4 },
      rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } });
    const put = await request.put(`${api}/gardens/${garden.id}`, { data: garden });
    expect(put.status(), await put.text()).toBe(200);
    await page.goto(`/gardens/${garden.id}?renderReview`);
    await page.getByRole('button', { name: '3D庭', exact: true }).click();
    const cart = await page.request.get(`${ec}/api/cart`);
    expect(cart.status(), await cart.text()).toBe(200);
    await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 8 / 8', { timeout: 60000 });
    await page.getByRole('button', { name: '上から見る', exact: true }).click();
    const card = page.getByTestId(`browse-${products[2].id}`); await card.scrollIntoViewIfNeeded();
    await card.dragTo(page.getByTestId('garden-canvas').locator('canvas'),
      { sourcePosition: { x: 35, y: 35 }, targetPosition: { x: 300, y: 400 } });
    await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 9 / 9', { timeout: 60000 });
    await page.getByTestId('object-details-toggle').click();
    await page.getByTestId('rotation-y').fill('37'); await page.getByTestId('uniform-scale').fill('1.25');
    await page.getByTestId('object-details-toggle').click();
    await expect(page.getByTestId('save-status')).toHaveText('保存済み');
    const snapshot = await request.get(`${api}/gardens/${garden.id}`).then((r) => r.json());
    await page.reload();
    await page.getByRole('button', { name: '3D庭', exact: true }).click();
    await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 9 / 9', { timeout: 60000 });
    expect(await request.get(`${api}/gardens/${garden.id}`).then((r) => r.json())).toEqual(snapshot);
    const bad = structuredClone(snapshot); bad.objects[0].modelComposition.parts[0].position[1] += 0.1;
    expect((await request.put(`${api}/gardens/${garden.id}`, { data: bad })).status()).toBe(400);
    expect(errors).toEqual([]);
    await page.screenshot({ path: `${evidence}/garden-reloaded.png` });
    await writeFile(`${evidence}/garden-reloaded.json`, JSON.stringify(snapshot, null, 2));
    await writeFile(`${evidence}/products.json`, JSON.stringify(products, null, 2));
  } finally {
    if (garden) expect((await request.delete(`${api}/gardens/${garden.id}`)).ok()).toBeTruthy();
    for (const p of products) expect((await request.delete(`${ec}/api/products/${p.id}`)).ok()).toBeTruthy();
  }
});
