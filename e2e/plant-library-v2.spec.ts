import { openPlantSettings, publishProduct } from './seller-wizard';
import { test, expect } from './test.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { productInput } from '../scripts/plant-library-presets.mjs';
import { plantPresetsV3 as plantPresets } from '../scripts/plant-library-v3-presets.mjs';

const ec = (process.env.KUSAKARI_EC_E2E_WEB_URL || 'http://127.0.0.1:15286');
const api = (process.env.KUSAKARI_CANVAS_E2E_API_URL ? process.env.KUSAKARI_CANVAS_E2E_API_URL + '/api' : 'http://127.0.0.1:18081/api');
const evidence = 'artifacts/plant-v4/library-regression';

test('seller can publish current grass; incompatible leaves are excluded and rejected', async ({ page, request }) => {
  let id: string | undefined;
  try {
    await page.goto(`${ec}/seller/products/new`);
    const form = page.locator('.product-form');
    await form.getByLabel('商品名', { exact: true }).fill('グラス出品入力検証');
    await form.getByLabel('商品番号', { exact: true }).fill(`GRASS-${randomUUID().slice(0, 8)}`);
    await form.getByLabel('商品説明', { exact: true }).fill('新しい植物形態の出品操作を検証します。');
    await form.getByLabel('選択店舗の在庫', { exact: true }).fill('20');
    await openPlantSettings(form, '60');
    await form.getByRole('combobox', { name: '植物タイプ', exact: true }).selectOption('grass');
    await expect(form.getByRole('combobox', { name: '葉の形', exact: true })).toHaveValue('grass');
    await expect(form.locator('[name="modelLeafShape"] option')).toHaveCount(1);
    await form.getByLabel('花がある', { exact: true }).check();
    await form.getByRole('combobox', { name: '花の形', exact: true }).selectOption('plume');
    await form.getByRole('button', { name: '植物のプレビューを確認' }).click();
    await form.locator('iframe').scrollIntoViewIfNeeded();
    await expect(page.frameLocator('iframe[title="植物の3Dプレビュー"]').getByTestId('preview-loaded')).toHaveText('loaded');
    const saved = page.waitForResponse((response) => response.url().endsWith('/api/products') && response.request().method() === 'POST');
    await publishProduct(form);
    const response = await saved;
    expect(response.status()).toBe(200);
    const product = await response.json(); id = product.id;
    expect(product.modelComposition.version).toBe(4);
    expect(product.plantModelProfile.plantType).toBe('grass');
    // Canvas intentionally returns 400 for all RequestValidationError failures.
    expect((await request.post(`${api}/model-assemblies/resolve`, { data: { ...product.plantModelProfile, leafShape: 'split' } })).status()).toBe(400);
    await page.reload();
    const catalog = await request.get(`${ec}/api/products?storeId=1`).then((r) => r.json());
    expect(catalog.find((p: { id: string }) => p.id === id).modelComposition).toEqual(product.modelComposition);
    await mkdir(evidence, { recursive: true });
    await page.screenshot({ path: `${evidence}/seller-after-reload.png` });
    await writeFile(`${evidence}/seller-product.json`, JSON.stringify(product, null, 2));
  } finally { if (id) expect((await request.delete(`${ec}/api/products/${id}`)).ok()).toBeTruthy(); }
});

test('30 plant products: actual GLBs, preview, drag, save, reload and exact purchase mapping', async ({ page, request }) => {
  test.setTimeout(360000);
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const products = [];
  const run = randomUUID().slice(0, 8);
  let garden;
  let failure;
  try {
    await page.setViewportSize({ width: 720, height: 540 });
    const catalog = await request.get(`${api}/model-parts`).then((r) => r.json());
    expect(catalog.version).toBe(4);
    expect(catalog.parts).toHaveLength(39);
    for (const part of catalog.parts) {
      const glb = await request.get(part.modelUrl);
      expect(glb.ok()).toBeTruthy();
      expect((await glb.body()).subarray(0, 4).toString()).toBe('glTF');
    }
    for (const preset of plantPresets) {
      const response = await request.post(`${ec}/api/products`, { data: {
        ...productInput(preset, '/images/olive.png'), sku: `V2-${run}-${preset.key}`, name: preset.name,
      } });
      expect(response.status(), await response.text()).toBe(200);
      const product = await response.json(); products.push(product);
      expect(product.modelComposition.version).toBe(4);
      expect(product.modelComposition.catalogVersion).toBe(4);
      expect(Math.abs(product.modelComposition.baseDimensions.height / (preset.profile.heightCm / 100) - 1)).toBeLessThan(0.005);
      await page.goto(`/model-preview?profile=${encodeURIComponent(JSON.stringify(preset.profile))}`);
      await expect(page.getByTestId('preview-loaded')).toHaveText('loaded');
      await page.locator('canvas').screenshot({ path: `${evidence}/${preset.key}.png` });
    }
    // The six original v1 compositions must remain saveable, not just readable.
    const original = JSON.parse(await readFile('e2e/fixtures/plant-composition-v1.json', 'utf8'));
    const legacy = [0, 1].map((i) => ({ id: randomUUID(), assetId: 'plant_modular', productId: `legacy-fixture-${i}`,
      productName: '旧版互換性検証', materialCode: `product.legacy-fixture-${i}`, modelComposition: original,
      rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }));
    const created = await request.post(`${api}/gardens`, { data: { name: `植物ライブラリ検証-${run}`, width: 30, depth: 30 } });
    expect(created.status()).toBe(201); garden = await created.json();
    garden.objects = products.map((product, i) => ({ id: randomUUID(), assetId: 'plant_modular',
      productId: product.id, productName: product.name, materialCode: product.canvasMaterialCode,
      modelComposition: product.modelComposition, position: { x: (i % 6 - 2.5) * 3.5, y: 0, z: (Math.floor(i / 6) - 2) * 4 },
      rotation: { x: 0, y: i * 0.13, z: 0 }, scale: { x: 1, y: 1, z: 1 } }));
    for (const [i, old] of legacy.entries()) garden.objects.push({ ...old, id: randomUUID(), position: { x: -12 + i * 3, y: 0, z: 12 } });
    const saved = await request.put(`${api}/gardens/${garden.id}`, { data: garden });
    expect(saved.status(), await saved.text()).toBe(200); garden = await saved.json();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/gardens/${garden.id}`);
    await page.getByRole('button', { name: '3D庭', exact: true }).click();
    await expect(page.getByTestId('model-loaded')).toHaveText(`読み込み済み: ${garden.objects.length} / ${garden.objects.length}`, { timeout: 60000 });
    await page.getByRole('button', { name: '上から見る', exact: true }).click();
    const card = page.getByTestId(`browse-${products[28].id}`);
    await card.scrollIntoViewIfNeeded();
    const target = page.getByTestId('garden-canvas').locator('canvas');
    await card.dragTo(target, { sourcePosition: { x: 35, y: 35 }, targetPosition: { x: 300, y: 400 } });
    await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 33 / 33', { timeout: 60000 });
    await expect(page.getByTestId('save-status')).toHaveText('保存済み');
    const snapshot = await request.get(`${api}/gardens/${garden.id}`).then((r) => r.json());
    await page.reload();
    await page.getByRole('button', { name: '3D庭', exact: true }).click();
    await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 33 / 33', { timeout: 60000 });
    expect(await request.get(`${api}/gardens/${garden.id}`).then((r) => r.json())).toEqual(snapshot);
    await page.screenshot({ path: `${evidence}/garden-after-reload.png` });
    const frame = await page.evaluate(() => new Promise<number>((resolve) => {
      let count = 0; const start = performance.now();
      function tick() { count++; if (performance.now() - start >= 1500) resolve(count * 1000 / (performance.now() - start)); else requestAnimationFrame(tick); }
      requestAnimationFrame(tick);
    }));
    const quote = await request.post(`${ec}/api/materials/quote`, { data: { storeId: 1,
      items: products.map((p) => ({ materialCode: p.canvasMaterialCode, quantity: 1, unit: 'piece' })) } });
    expect(quote.status()).toBe(200);
    const matches = await quote.json();
    for (const [i, match] of matches.entries()) {
      expect(match.candidates).toHaveLength(1); expect(match.candidates[0].product.id).toBe(products[i].id);
    }
    const tampered = structuredClone(snapshot); tampered.objects[0].modelComposition.parts[0].position[1] += 1;
    expect((await request.put(`${api}/gardens/${garden.id}`, { data: tampered })).status()).toBe(400);
    expect(errors).toEqual([]);
    await writeFile(`${evidence}/garden-after-reload.json`, JSON.stringify(snapshot, null, 2));
    await writeFile(`${evidence}/products.json`, JSON.stringify(products, null, 2));
    await writeFile(`${evidence}/metrics.json`, JSON.stringify({ productCount: products.length, parts: catalog.parts.length,
      placed: snapshot.objects.length, legacy: legacy.length, animationFramesPerSecond: frame, pageErrors: errors }, null, 2));
  } catch (error) { failure = error; }
  finally {
    try {
      if (garden) expect((await request.delete(`${api}/gardens/${garden.id}`)).ok()).toBeTruthy();
      for (const product of products) expect((await request.delete(`${ec}/api/products/${product.id}`)).ok()).toBeTruthy();
    } catch (error) {
      await test.info().attach('cleanup-error', { body: String(error), contentType: 'text/plain' });
      if (!failure) failure = error;
    }
  }
  if (failure) throw failure;
});
