import { openPlantSettings, publishProduct } from './seller-wizard';
import { test, expect, Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import type { GardenDocument, PlantComposition } from '../frontend/src/types/garden';

type TestProduct = { id: string; name: string; plantModelProfile: Record<string, unknown>;
  modelComposition: PlantComposition } & Record<string, unknown>;

const ec = (process.env.KUSAKARI_EC_E2E_WEB_URL || 'http://127.0.0.1:15286');
const api = (process.env.KUSAKARI_CANVAS_E2E_API_URL ? process.env.KUSAKARI_CANVAS_E2E_API_URL + '/api' : 'http://127.0.0.1:18081/api');
const evidence = 'artifacts/e2e/plant-model';


async function dragProduct(page: Page, source: ReturnType<Page['locator']>, index = 0) {
  const target = page.getByTestId('garden-canvas').locator('canvas');
  const bounds = await target.boundingBox();
  if (!bounds) throw new Error('Canvas bounds missing');
  await source.dragTo(target, { targetPosition: { x: bounds.width * (0.35 + (index % 3) * 0.15),
    y: bounds.height * (0.4 + Math.floor(index / 3) * 0.15) }, sourcePosition: { x: 35, y: 35 } });
}

test('seller features create six plant compositions; catalog and shopping-list drag placements survive reload', async ({ page, context, request }) => {
  // Preserve the budget from playwright.plant-model.config.ts in the full suite.
  test.setTimeout(360000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mkdir(evidence, { recursive: true });
  const products: TestProduct[] = [];
  let garden: GardenDocument | undefined;
  let failure: unknown;
  try {
    await page.goto(`${ec}/seller/products/new`);
    const form = page.locator('.product-form');
    for (const type of ['tree', 'shrub', 'flower']) {
      for (let variant = 0; variant < 2; variant++) {
        const name = `組立検証-${type}-${variant}-${randomUUID().slice(0, 4)}`;
        await form.getByLabel('商品名', { exact: true }).fill(name);
        await form.getByLabel('商品番号', { exact: true }).fill(`MOD-${randomUUID().slice(0, 12)}`);
        await form.getByLabel('商品説明', { exact: true }).fill('専用MySQLで植物構成の保存・復元を検証します。');
        await form.getByLabel('選択店舗の在庫', { exact: true }).fill('20');
        await openPlantSettings(form, type === 'tree' ? '250' : type === 'shrub' ? '100' : '55');
        await form.getByRole('combobox', { name: '植物タイプ', exact: true }).selectOption(type);
        await form.getByLabel('植物の幅（cm）', { exact: true }).fill(String(type === 'tree' ? 140 + variant * 60 : 60 + variant * 30));
        await form.getByRole('combobox', { name: '葉の形', exact: true }).selectOption(variant ? 'narrow' : 'oval');
        await form.getByRole('slider', { name: '葉の密度', exact: true }).press('Home');
        await form.getByRole('slider', { name: '葉の密度', exact: true }).press(variant ? 'End' : 'ArrowRight');
        if (type === 'flower' || (type === 'shrub' && variant)) {
          await form.getByLabel('花がある', { exact: true }).check();
          await form.getByRole('combobox', { name: '花の形', exact: true }).selectOption(variant ? 'eight' : 'five');
        }
        await form.getByRole('button', { name: '植物のプレビューを確認' }).click();
        await form.locator('iframe').scrollIntoViewIfNeeded();
        const preview = page.frameLocator('iframe[title="植物の3Dプレビュー"]');
        await expect(preview.getByTestId('preview-loaded')).toHaveText('loaded');
        await form.locator('iframe').screenshot({ path: `${evidence}/${type}-${variant}-preview.png` });
        const saved = page.waitForResponse((response) => response.url().endsWith('/api/products') && response.request().method() === 'POST', { timeout: 20000 });
        await publishProduct(form);
        const response = await saved;
        expect(response.status()).toBe(200);
        const product = await response.json();
        expect(product.modelComposition.parts.length).toBeGreaterThan(20);
        expect(product.modelComposition.profile.plantType).toBe(type);
        const dimensions = product.modelComposition.baseDimensions;
        expect(Math.abs(dimensions.height / (product.plantModelProfile.heightCm as number / 100) - 1)).toBeLessThan(0.005);
        expect(Math.abs(Math.max(dimensions.width, dimensions.depth) / (product.plantModelProfile.widthCm as number / 100) - 1)).toBeLessThan(0.005);
        const resolved = await page.request.post(`${api}/model-assemblies/resolve`, { data: product.plantModelProfile });
        expect(resolved.ok()).toBeTruthy();
        expect(await resolved.json()).toEqual(product.modelComposition);
        products.push(product);
        await expect(page).toHaveURL(`${ec}/seller/products`);
        await page.goto(`${ec}/seller/products/new`);
      }
    }
    const catalog = await page.request.get(`${ec}/api/products?storeId=1`).then((response) => response.json());
    for (const product of products) expect(catalog.find((item: TestProduct) => item.id === product.id).modelComposition).toEqual(product.modelComposition);
    const created = await page.request.post(`${api}/gardens`, { data: { name: `組立配置-${randomUUID().slice(0, 8)}`, width: 10, depth: 8 } });
    expect(created.status()).toBe(201);
    garden = await created.json() as GardenDocument;
    await page.goto(`/gardens/${garden.id}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: '3D庭', exact: true }).click();
    const unsupported = page.getByTestId('browse-olive');
    await expect(unsupported).toContainText('3Dモデル未設定');
    await expect(unsupported.getByRole('button', { name: '庭に配置' })).toBeDisabled();
    await expect(page.locator('#catalog-panel')).toHaveCount(0);
    const separator = page.getByRole('separator', { name: '商品サイドバーの幅' });
    const handle = await separator.boundingBox();
    if (!handle) throw new Error('Sidebar resize handle missing');
    await page.mouse.move(handle.x + handle.width / 2, handle.y + 150);
    await page.mouse.down(); await page.mouse.move(handle.x - 100, handle.y + 150, { steps: 8 }); await page.mouse.up();
    expect(Number(await separator.getAttribute('aria-valuenow'))).toBeGreaterThan(450);
    const width = await separator.getAttribute('aria-valuenow');
    await page.getByRole('button', { name: '上から見る', exact: true }).click();
    for (const [index, product] of products.entries()) {
      const card = page.getByTestId(`browse-${product.id}`);
      await card.scrollIntoViewIfNeeded();
      await dragProduct(page, card, index);
      await expect(page.getByTestId('model-loaded')).toHaveText(`読み込み済み: ${index + 1} / ${index + 1}`);
      await expect(page.getByTestId('save-status')).toHaveText('保存済み');
    }
    await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 6 / 6');
    const firstCard = page.getByTestId(`browse-${products[0].id}`);
    await page.getByRole('tab', { name: /買い物リスト/ }).click();
    const listLine = page.getByTestId(`shopping-line-${products[0].id}`);
    await expect(listLine).toBeVisible();
    await dragProduct(page, listLine);
    await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 7 / 7');
    await expect(page.getByTestId('save-status')).toHaveText('保存済み');
    await page.getByRole('tab', { name: '商品一覧', exact: true }).click();
    await firstCard.getByRole('button', { name: '庭に配置' }).click();
    await page.getByTestId('garden-canvas').locator('canvas').click({ position: { x: 300, y: 430 } });
    await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 8 / 8');
    await page.getByTestId('object-details-toggle').click();
    await page.getByTestId('rotation-y').fill('37');
    await page.getByTestId('uniform-scale').fill('1.25');
    await page.getByTestId('object-details-toggle').click();
    await page.getByRole('button', { name: '初期視点', exact: true }).click();
    await expect(page.getByTestId('save-status')).toHaveText('保存済み');
    const snapshot = await page.request.get(`${api}/gardens/${garden.id}`).then((response) => response.json());
    expect(snapshot.objects).toHaveLength(8);
    for (const object of snapshot.objects) {
      const product = products.find((item) => item.id === object.productId);
      if (!product) throw new Error('Placed product missing from test fixtures');
      expect(object.modelComposition).toEqual(product.modelComposition);
      expect(object.materialCode).toBe(`product.${product.id}`);
    }
    const tampered = structuredClone(snapshot);
    tampered.objects[0].modelComposition.parts[0].position[1] += 10;
    expect((await page.request.put(`${api}/gardens/${garden.id}`, { data: tampered })).status()).toBe(400);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: '3D庭', exact: true }).click();
    await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 8 / 8');
    await expect(page.getByRole('separator', { name: '商品サイドバーの幅' })).toHaveAttribute('aria-valuenow', width!);
    const reloaded = await page.request.get(`${api}/gardens/${garden.id}`).then((response) => response.json());
    expect(reloaded).toEqual(snapshot);
    // Editing the product creates a new composition; the garden retains its saved snapshot.
    const p = products[0];
    const { id, unit, source, sourceUpdatedAt, publishedAt, active, publicationStatus, modelComposition, canvasMaterialCode, ...input } = p;
    void id; void unit; void source; void sourceUpdatedAt; void publishedAt; void active; void publicationStatus; void modelComposition; void canvasMaterialCode;
    const changed = await page.request.put(`${ec}/api/products/${p.id}`, {
      data: { ...input, storeId: 1, plantModelProfile: { ...p.plantModelProfile, leafShape: 'needle' } },
    });
    expect(changed.status()).toBe(200);
    expect((await changed.json()).modelComposition).not.toEqual(p.modelComposition);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: '3D庭', exact: true }).click();
    await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 8 / 8');
    expect(await page.request.get(`${api}/gardens/${garden.id}`).then((response) => response.json())).toEqual(snapshot);
    await test.step('Capture the reloaded 3D garden', () => page.screenshot({ path: `${evidence}/garden-after-reload.png`, fullPage: true }));
    await writeFile(`${evidence}/garden-after-reload.json`, JSON.stringify(snapshot, null, 2));
    await writeFile(`${evidence}/products.json`, JSON.stringify(products, null, 2));
    const ecPage = await context.newPage();
    expect((await ecPage.request.get(`${ec}/api/cart`).then((r) => r.json())).items).toHaveLength(0);
    await ecPage.goto(`${ec}/cart/gardens/${garden.id}`, { waitUntil: 'domcontentloaded' });
    await ecPage.getByRole('checkbox', { name: products[0].name + 'を選択', exact: true }).check();
    await ecPage.getByRole('button', { name: '選択した商品をカートに追加', exact: true }).click();
    await ecPage.waitForURL(`${ec}/cart`);
    await expect(ecPage.getByText(products[0].name, { exact: true })).toBeVisible();
    await ecPage.close();
    const photo = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 600;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#b8ccb2'; ctx.fillRect(0, 0, 800, 600);
      ctx.fillStyle = '#e5dac5'; ctx.fillRect(80, 60, 640, 480);
      const corners = [{ x: 0.1, y: 0.9 }, { x: 0.9, y: 0.9 }, { x: 0.9, y: 0.1 }, { x: 0.1, y: 0.1 }];
      return { dataUrl: canvas.toDataURL('image/png'), imageWidth: 800, imageHeight: 600, corners, boundary: corners };
    });
    const legacy = { id: randomUUID(), assetId: 'bench_wood', position: { x: 3, y: 0, z: 2 },
      rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } };
    const photoSaved = await page.request.put(`${api}/gardens/${garden.id}`, {
      data: { ...snapshot, photo, objects: [...snapshot.objects, legacy] },
    });
    expect(photoSaved.status()).toBe(200);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 9 / 9');
    const photoCard = page.getByTestId(`browse-${products[2].id}`);
    const photoTarget = page.getByTestId('photo-model-canvas').locator('canvas');
    const photoBounds = await photoTarget.boundingBox();
    if (!photoBounds) throw new Error('Photo canvas bounds missing');
    await photoCard.dragTo(photoTarget, { sourcePosition: { x: 35, y: 35 },
      targetPosition: { x: photoBounds.width * 0.55, y: photoBounds.height * 0.55 } });
    await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 10 / 10');
    await expect(page.getByTestId('save-status')).toHaveText('保存済み');
    const photoSnapshot = await page.request.get(`${api}/gardens/${garden.id}`).then((response) => response.json());
    expect(photoSnapshot.objects.find((object: { id: string }) => object.id === legacy.id)).toEqual(legacy);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 10 / 10');
    expect(await page.request.get(`${api}/gardens/${garden.id}`).then((response) => response.json())).toEqual(photoSnapshot);
    await page.screenshot({ path: `${evidence}/photo-after-reload.png`, fullPage: true });
    await writeFile(`${evidence}/photo-after-reload.json`, JSON.stringify(photoSnapshot, null, 2));
    expect(errors).toEqual([]);
  } catch (error) {
    failure = error;
  } finally {
    const cleanupErrors: string[] = [];
    const urls = products.map((product) => `${ec}/api/products/${product.id}`);
    if (garden) urls.unshift(`${api}/gardens/${garden.id}`);
    for (const url of urls) {
      try { await request.delete(url, { timeout: 5000 }); }
      catch (error) { cleanupErrors.push(String(error)); }
    }
    if (cleanupErrors.length) {
      await test.info().attach('fixture-cleanup-errors', { body: cleanupErrors.join('\n'), contentType: 'text/plain' });
      if (!failure) failure = new Error('Fixture cleanup failed; see fixture-cleanup-errors.');
    }
  }
  if (failure) throw failure;
});

test('model validation, legacy product updates and exact-product material quote use real APIs', async ({ request }) => {
  const catalog = await request.get(`${ec}/api/products?storeId=1`).then((response) => response.json());
  const responseFields = new Set(['id', 'unit', 'source', 'sourceUpdatedAt', 'publishedAt', 'active', 'publicationStatus',
    'modelComposition', 'canvasMaterialCode', 'plantModelProfile']);
  const input = Object.fromEntries(Object.entries(catalog[0]).filter(([key]) => !responseFields.has(key)));
  const profile = { plantType: 'tree', heightCm: 200, widthCm: 100, crownShape: 'round', branchCount: 12,
    branchAngle: 45, trunkThicknessCm: 8, leafShape: 'oval', leafSizeCm: 12, leafDensity: 'medium',
    leafColor: '#4f793b', flowerEnabled: false, flowerShape: 'five', flowerSizeCm: 10,
    flowerColor: '#df7799', seed: 12345 };
  const body = { ...input, storeId: 1, heightCm: 200, stock: 20, name: '構成API検証',
    sku: `API-MOD-${randomUUID().slice(0, 8)}` };
  let id: string | undefined;
  try {
    const created = await request.post(`${ec}/api/products`, { data: { ...body, plantModelProfile: profile } });
    expect(created.status()).toBe(200);
    const product = await created.json();
    id = product.id;
    const quote = await request.post(`${ec}/api/materials/quote`, {
      data: { storeId: 1, items: [{ materialCode: product.canvasMaterialCode, quantity: 2, unit: 'piece' }] },
    });
    expect(quote.status()).toBe(200);
    const matches = await quote.json();
    expect(matches[0].candidates).toHaveLength(1);
    expect(matches[0].candidates[0].product.id).toBe(id);
    expect(matches[0].candidates[0].purchaseQuantity).toBe(2);
    const updated = await request.put(`${ec}/api/products/${id}`, { data: { ...body, stock: 10 } });
    expect(updated.status()).toBe(200);
    const saved = await updated.json();
    expect(saved.modelComposition).toEqual(product.modelComposition);
    expect(saved.plantModelProfile).toEqual({ ...profile, botanicalForm: null });
    expect(saved.stock).toBe(10);
    const invalid = await request.put(`${ec}/api/products/${id}`, {
      data: { ...body, name: '失敗時はこの名前を保存しない', plantModelProfile: { ...profile, heightCm: 250 } },
    });
    expect(invalid.status()).toBe(400);
    expect((await request.put(`${ec}/api/products/${id}`, {
      data: { ...body, modelComposition: product.modelComposition },
    })).status()).toBe(400);
    const missingPrice: Record<string, unknown> = { ...body };
    delete missingPrice.priceYen;
    expect((await request.post(`${ec}/api/products`, { data: missingPrice })).status()).toBe(400);
    const current = await request.get(`${ec}/api/products?storeId=1`).then((response) => response.json());
    expect(current.find((item: TestProduct) => item.id === id)).toEqual(saved);
    await mkdir(evidence, { recursive: true });
    await writeFile(`${evidence}/material-quote.json`, JSON.stringify(matches, null, 2));
  } finally {
    if (id) await request.delete(`${ec}/api/products/${id}`);
  }
});
