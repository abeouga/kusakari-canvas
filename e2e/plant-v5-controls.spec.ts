import { openPlantSettings, publishProduct } from './seller-wizard';
import { seedGardenPhoto } from './garden-photo';
import { test, expect } from './test.js';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import type { GardenDocument, PlantComposition } from '../frontend/src/types/garden';
import { showProductsTab } from './catalog-fixture';

const ec = (process.env.KUSAKARI_EC_E2E_WEB_URL || 'http://127.0.0.1:15286');
const api = (process.env.KUSAKARI_CANVAS_E2E_API_URL ? process.env.KUSAKARI_CANVAS_E2E_API_URL + '/api' : 'http://127.0.0.1:18081/api');
const evidence = 'artifacts/e2e/plant-v5';
type Product = { id: string; name: string; plantModelProfile: Record<string, unknown>; modelComposition: PlantComposition };

test('seller picks a species, adjusts stem, branch and leaf controls; the v5 model is saved, placed and reloaded', async ({ page, request }) => {
  test.setTimeout(240000);
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let product: Product | undefined;
  let garden: GardenDocument | undefined;
  try {
    await page.goto(`${ec}/seller/products/new`);
    const form = page.locator('.product-form');
    await form.getByLabel('商品名', { exact: true }).fill(`v5形状検証-${randomUUID().slice(0, 6)}`);
    await form.getByLabel('商品番号', { exact: true }).fill(`V5-${randomUUID().slice(0, 12)}`);
    await form.getByLabel('商品説明', { exact: true }).fill('専用DBで植物の茎・枝・葉の調整を検証します。');
    await form.getByLabel('選択店舗の在庫', { exact: true }).fill('10');
    await openPlantSettings(form, '200');
    await form.getByLabel('植物の幅（cm）', { exact: true }).fill('130');
    // A species fixes the plant type and leaf shape and starts every shape control as automatic.
    await form.getByRole('combobox', { name: '植物の種類', exact: true }).selectOption('olive');
    await expect(form.getByRole('combobox', { name: '植物タイプ', exact: true })).toHaveValue('tree');
    await expect(form.getByRole('combobox', { name: '葉の形', exact: true })).toHaveValue('narrow');
    await expect(form.getByText('幹・茎の曲がり（%）自動（植物タイプ・種類に合わせる）')).toBeVisible();
    await form.getByLabel('幹・茎の曲がり（%）を自動にする', { exact: true }).uncheck();
    await form.getByLabel('幹・茎の曲がり（%）', { exact: true }).fill('80');
    await form.getByLabel('枝の垂れ下がり（%）を自動にする', { exact: true }).uncheck();
    await form.getByLabel('枝の垂れ下がり（%）', { exact: true }).fill('60');
    await form.getByLabel('先端の葉の大きさ（%）を自動にする', { exact: true }).uncheck();
    await form.getByLabel('先端の葉の大きさ（%）', { exact: true }).fill('50');
    await form.getByLabel('葉の付き方を自動にする', { exact: true }).uncheck();
    await form.getByRole('combobox', { name: '葉の付き方', exact: true }).selectOption('whorled');
    await form.getByRole('slider', { name: '葉の密度', exact: true }).focus();
    await form.getByRole('slider', { name: '葉の密度', exact: true }).press('End');
    await form.getByRole('button', { name: '植物のプレビューを確認' }).click();
    await form.locator('iframe').scrollIntoViewIfNeeded();
    await expect(page.frameLocator('iframe[title="植物の3Dプレビュー"]').getByTestId('preview-loaded')).toHaveText('loaded', { timeout: 60000 });
    await form.locator('iframe').screenshot({ path: `${evidence}/preview.png` });
    const saving = page.waitForResponse((r) => r.url().endsWith('/api/products') && r.request().method() === 'POST');
    await publishProduct(form);
    const response = await saving;
    expect(response.status(), await response.text()).toBe(200);
    product = await response.json() as Product;
    expect(product.plantModelProfile).toMatchObject({ botanicalForm: 'olive', plantType: 'tree', leafShape: 'narrow',
      stemCurve: 0.8, branchDroop: 0.6, leafTipRatio: 0.5, leafArrangement: 'whorled', leafDensity: 'dense' });
    // Untouched controls stay automatic and are not stored.
    expect(product.plantModelProfile).not.toHaveProperty('stemCount');
    const composition = product.modelComposition;
    expect([composition.version, composition.catalogVersion]).toEqual([5, 4]);
    expect(Math.abs(composition.baseDimensions.height / 2 - 1)).toBeLessThan(0.005);
    expect(Math.abs(Math.max(composition.baseDimensions.width, composition.baseDimensions.depth) / 1.3 - 1)).toBeLessThan(0.005);
    // The same features always give the same parts; the adjusted controls change them.
    const again = await request.post(`${api}/model-assemblies/resolve`, { data: product.plantModelProfile });
    expect(await again.json()).toEqual(composition);
    const automatic = await request.post(`${api}/model-assemblies/resolve`, { data: { ...product.plantModelProfile,
      stemCurve: null, branchDroop: null, leafTipRatio: null, leafArrangement: null } }).then((r) => r.json());
    expect(automatic.parts).not.toEqual(composition.parts);

    // The seller sees the stored values when editing the product again.
    await expect(page).toHaveURL(`${ec}/seller/products`);
    await page.getByTestId(`manage-${product.id}`).getByRole('button', { name: '編集', exact: true }).click();
    await form.locator('.wizard-steps').getByRole('button', { name: /庭オブジェクト/ }).click();
    await form.locator('.model-details > summary').click();
    await expect(form.getByRole('combobox', { name: '植物の種類', exact: true })).toHaveValue('olive');
    await expect(form.getByLabel('幹・茎の曲がり（%）', { exact: true })).toHaveValue('80');
    await expect(form.getByLabel('枝の垂れ下がり（%）', { exact: true })).toHaveValue('60');
    await expect(form.getByRole('combobox', { name: '葉の付き方', exact: true })).toHaveValue('whorled');
    await expect(form.getByLabel('幹・茎の本数を自動にする', { exact: true })).toBeChecked();

    const created = await request.post(`${api}/gardens`, { data: { name: `v5配置-${randomUUID().slice(0, 8)}`, width: 8, depth: 8 } });
    expect(created.status()).toBe(201);
    // 庭写真が未アップロードの庭には配置できないため、先に確定済みの写真を保存します（#15）。
    garden = await seedGardenPhoto(page, (await created.json() as GardenDocument).id);
    await page.goto(`/gardens/${garden.id}`);
    await page.getByRole('button', { name: '3D庭', exact: true }).click();
    await page.getByRole('button', { name: '上から見る', exact: true }).click();
    await showProductsTab(page);
    const card = page.getByTestId(`browse-${product.id}`);
    await card.scrollIntoViewIfNeeded();
    await card.dragTo(page.getByTestId('garden-canvas').locator('canvas'),
      { sourcePosition: { x: 35, y: 35 }, targetPosition: { x: 300, y: 380 } });
    await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 1 / 1', { timeout: 60000 });
    await expect(page.getByTestId('save-status')).toHaveText('保存済み');
    const snapshot = await request.get(`${api}/gardens/${garden.id}`).then((r) => r.json());
    expect(snapshot.objects).toHaveLength(1);
    expect(snapshot.objects[0].modelComposition).toEqual(composition);
    await page.reload();
    await page.getByRole('button', { name: '3D庭', exact: true }).click();
    await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 1 / 1', { timeout: 60000 });
    const reloaded = await request.get(`${api}/gardens/${garden.id}`).then((r) => r.json());
    expect(reloaded).toEqual(snapshot);
    await page.getByRole('button', { name: '初期視点', exact: true }).click();
    await page.screenshot({ path: `${evidence}/garden-after-reload.png` });
    await writeFile(`${evidence}/garden-after-reload.json`, JSON.stringify(reloaded, null, 2));
    await writeFile(`${evidence}/product.json`, JSON.stringify(product, null, 2));
    expect(errors).toEqual([]);
  } finally {
    if (garden) expect((await request.delete(`${api}/gardens/${garden.id}`)).ok()).toBeTruthy();
    if (product) expect((await request.delete(`${ec}/api/products/${product.id}`)).ok()).toBeTruthy();
  }
});
