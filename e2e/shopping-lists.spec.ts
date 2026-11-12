import { test, expect, type APIRequestContext, type Page } from './test.js';
import { seedGardenPhoto } from './garden-photo';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import type { GardenDocument, PlantComposition } from '../frontend/src/types/garden';
import { showProductsTab } from './catalog-fixture';
import { sellerRequest } from './seller-session.js';

const ec = (process.env.KUSAKARI_EC_E2E_WEB_URL || 'http://127.0.0.1:15286');
const canvas = (process.env.KUSAKARI_CANVAS_E2E_API_URL ? process.env.KUSAKARI_CANVAS_E2E_API_URL + '/api' : 'http://127.0.0.1:18081/api');
const evidence = 'artifacts/e2e/shopping-lists';
type Garden = GardenDocument;
type Product = { id: string; name: string; modelComposition: PlantComposition; [key: string]: unknown };
type Line = { key: string; products: { id: string }[] };
const profile = { plantType: 'flower', heightCm: 55, widthCm: 65, crownShape: 'round', branchCount: 6,
  branchAngle: 45, trunkThicknessCm: 0.6, leafShape: 'narrow', leafSizeCm: 8, leafDensity: 'medium',
  leafColor: '#4f793b', flowerEnabled: true, flowerShape: 'five', flowerSizeCm: 8, flowerColor: '#9062ba', seed: 12345 };

async function createProduct(request: APIRequestContext) {
  const seller = await sellerRequest();
  const products = await request.get(`${ec}/api/products?storeId=1`).then(r => r.json());
  const excluded = new Set(['id', 'unit', 'source', 'sourceUpdatedAt', 'publishedAt', 'active', 'publicationStatus', 'modelComposition', 'canvasMaterialCode', 'sellerStoreId', 'sellerStoreName']);
  const input = Object.fromEntries(Object.entries(products[0]).filter(([key]) => !excluded.has(key)));
  const body = { ...input, storeId: 1, name: 'リスト用草花-' + randomUUID().slice(0, 8),
    sku: 'SL-' + randomUUID().slice(0, 12), stock: 20, heightCm: 55, plantModelProfile: profile };
  const response = await seller.post(`${ec}/api/products`, { data: body });
  expect(response.status()).toBe(200);
  return { product: await response.json() as Product, body };
}
async function createGarden(request: APIRequestContext, suffix: string): Promise<Garden> {
  const response = await request.post(`${canvas}/gardens`, { data: { name: `リスト検証-${randomUUID().slice(0, 8)}-${suffix}` } });
  expect(response.status()).toBe(201);
  return response.json();
}
async function loadGarden(request: APIRequestContext, id: string): Promise<Garden> {
  return request.get(`${canvas}/gardens/${id}`).then(r => r.json());
}
async function drag(page: Page, source: ReturnType<Page['locator']>, x = 0.5) {
  const target = page.getByTestId('garden-canvas').locator('canvas');
  const bounds = await target.boundingBox();
  if (!bounds) throw new Error('Canvas missing');
  await source.dragTo(target, { sourcePosition: { x: 35, y: 35 }, targetPosition: { x: bounds.width * x, y: bounds.height * 0.5 } });
}
async function saved(page: Page, count: number) {
  await expect(page.getByTestId('model-loaded')).toHaveText(`読み込み済み: ${count} / ${count}`);
  await expect(page.getByTestId('save-status')).toHaveText('保存済み');
}
function object(assetId: string, index = 0, product?: Product) {
  return { id: randomUUID(), assetId, position: { x: index % 4 - 2, y: 0, z: Math.floor(index / 4) % 4 - 2 },
    rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
    ...(product ? { productId: product.id, productName: product.name, materialCode: `product.${product.id}`, modelComposition: product.modelComposition } : {}) };
}

function legacyCandidate(productId: string, remove = false) {
  if (!/^[a-f0-9-]{36}$/.test(productId)) throw new Error('Only a newly-created test product is allowed');
  const statement = remove
    ? `DELETE FROM material_products WHERE material_code='garden.bench' AND product_id='${productId}';`
    : `INSERT INTO material_products(material_code,product_id) VALUES('garden.bench','${productId}');`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    "import { sql } from './e2e/database.js'; sql(process.argv[1]);", statement], {
    // The same EC checkout the suite starts (KUSAKARI_EC_DIRECTORY), so the fixture reaches that checkout's E2E database.
    cwd: resolve(process.env.KUSAKARI_EC_DIRECTORY || '../kusakari-ec'), encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error('Dedicated legacy candidate fixture failed: ' + result.stderr);
}

test('two gardens have separate live lists; selection adds to the single EC cart and survives reload', async ({ page, context, request, seller }) => {
  await mkdir(evidence, { recursive: true });
  const { product } = await createProduct(request);
  // 庭写真が未アップロードの庭には配置できないため、先に確定済みの写真を保存します（#15）。
  const a = await seedGardenPhoto(page, (await createGarden(request, 'A')).id);
  const b = await seedGardenPhoto(page, (await createGarden(request, 'B')).id);
  const pageErrors: string[] = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  try {
    await page.goto(`/gardens/${a.id}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: '3D庭', exact: true }).click();
    await page.getByRole('tab', { name: '商品一覧', exact: true }).click();
    await page.getByLabel('商品を検索', { exact: true }).fill(product.name);
    const card = page.getByTestId(`browse-${product.id}`);
    await expect(card.getByRole('button', { name: 'カートに追加' })).toHaveCount(0);
    await drag(page, card);
    await saved(page, 1);
    await page.getByRole('tab', { name: /買い物リスト/ }).click();
    const listLine = page.getByTestId(`shopping-line-${product.id}`);
    await expect(listLine.getByTestId('placement-count')).toHaveText('1');
    await drag(page, listLine, 0.65);
    await saved(page, 2);
    await expect(listLine.getByTestId('placement-count')).toHaveText('2');
    expect((await page.request.get(`${ec}/api/cart`).then(r => r.json())).items).toHaveLength(0);
    const snapshotA = await loadGarden(request, a.id);
    const listA = await request.get(`${canvas}/gardens/${a.id}/shopping-list`).then(r => r.json());
    expect(listA.items[0].quantity).toBe(2);
    expect(JSON.stringify(listA)).not.toMatch(/modelComposition|dataUrl|parts/);
    await page.screenshot({ path: `${evidence}/canvas-list-a.png` });

    await page.goto(`/gardens/${b.id}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: '3D庭', exact: true }).click();
    await page.getByRole('tab', { name: /買い物リスト/ }).click();
    await expect(page.getByTestId(`shopping-line-${product.id}`)).toHaveCount(0);
    await page.getByRole('tab', { name: '商品一覧', exact: true }).click();
    await page.getByLabel('商品を検索', { exact: true }).fill(product.name);
    await drag(page, page.getByTestId(`browse-${product.id}`));
    await saved(page, 1);
    expect(await loadGarden(request, a.id)).toEqual(snapshotA);

    // EC issue #88: the garden-only list screens are gone; the cart's "add from garden" dialog lists each garden.
    const ecPage = await context.newPage();
    await ecPage.goto(`${ec}/cart?garden=${a.id}`, { waitUntil: 'domcontentloaded' });
    const dialog = ecPage.getByRole('dialog', { name: '庭に設置したものから追加', exact: true });
    const line = dialog.getByTestId(`garden-item-product:${product.id}`);
    await expect(line).toContainText('必要数 2点');
    await dialog.getByRole('button', { name: new RegExp(b.name) }).click();
    await expect(line).toContainText('必要数 1点');
    const check = line.getByRole('checkbox', { name: product.name + 'を選択', exact: true });
    await expect(check).not.toBeChecked();
    await check.check();
    // A real update from the Canvas page is polled by the already-open EC dialog; a changed list clears the selection.
    await page.getByRole('tab', { name: /買い物リスト/ }).click();
    await drag(page, page.getByTestId(`shopping-line-${product.id}`), 0.65);
    await saved(page, 2);
    await expect(line).toContainText('必要数 2点', { timeout: 5000 });
    await expect(check).not.toBeChecked();
    await dialog.getByRole('button', { name: 'すべて選択', exact: true }).click();
    await expect(check).toBeChecked();
    await dialog.getByRole('button', { name: '2点をカートに追加', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(ecPage).toHaveURL(`${ec}/cart`);
    expect((await ecPage.request.get(`${ec}/api/cart`).then(r => r.json())).items[0].quantity).toBe(2);
    await ecPage.reload({ waitUntil: 'domcontentloaded' });
    await expect(ecPage.locator('.cart-line').filter({ hasText: product.name })).toHaveCount(1);
    await ecPage.screenshot({ path: `${evidence}/ec-cart-and-gardens.png`, fullPage: true });
    await writeFile(`${evidence}/garden-a.json`, JSON.stringify(snapshotA, null, 2));
    await writeFile(`${evidence}/garden-b.json`, JSON.stringify(await loadGarden(request, b.id), null, 2));
    expect(pageErrors).toEqual([]);
    await ecPage.close();
  } finally {
    await request.delete(`${canvas}/gardens/${a.id}`);
    await request.delete(`${canvas}/gardens/${b.id}`);
    await seller.delete(`${ec}/api/products/${product.id}`);
  }
});

test('partial transfer, duplicate requests, cart limits, stale gardens and invalid selections use real transactions', async ({ request, seller }) => {
  const { product, body } = await createProduct(request);
  const garden = await createGarden(request, 'A');
  try {
    const response = await request.put(`${canvas}/gardens/${garden.id}`, { data: { ...garden,
      objects: [object('plant_modular', 0, product), object('plant_modular', 1, product), object('bench_wood', 2)] } });
    expect(response.ok()).toBeTruthy();
    const saved = await response.json();
    const cart = await request.get(`${ec}/api/cart`).then(r => r.json());
    const detail = await request.get(`${ec}/api/shopping-lists/${garden.id}`).then(r => r.json());
    expect(detail.items).toHaveLength(2);
    const selected = detail.items.map((line: Line) => ({ key: line.key, productId: line.products[0].id }));
    const input = { cartRevision: cart.revision, gardenRevision: saved.revision, listRevision: detail.listRevision, items: selected };
    expect((await seller.put(`${ec}/api/products/${product.id}`, { data: { ...body, stock: 1, expectedStock: body.stock } })).ok()).toBeTruthy();
    const url = `${ec}/api/cart/shopping-lists/${garden.id}/items`;
    const concurrent = await Promise.all([request.post(url, { data: input }), request.post(url, { data: input })]);
    expect(concurrent.map(r => r.status()).sort()).toEqual([200, 409]);
    const transferred = concurrent.find(r => r.status() === 200)!;
    expect(transferred.status()).toBe(200);
    const result = await transferred.json();
    expect(result.added).toHaveLength(1);
    expect(result.skipped[0].code).toBe('OUT_OF_STOCK');
    expect(result.cart.items.find((line: { product: { id: string } }) => line.product.id === product.id)).toBeUndefined();
    expect((await request.post(url, { data: input })).status()).toBe(409);
    const invalid = { ...input, cartRevision: result.cart.revision, items: [{ key: 'product:fake', productId: product.id }] };
    expect((await request.post(url, { data: invalid })).status()).toBe(400);
    expect((await request.post(url, { data: { ...input, cartRevision: result.cart.revision, quantity: 20 } })).status()).toBe(400);
    const newer = await request.put(`${canvas}/gardens/${garden.id}`, { data: { ...saved, objects: [...saved.objects, object('bench_wood', 3)] } });
    expect(newer.ok()).toBeTruthy();
    expect((await request.post(url, { data: { ...input, cartRevision: result.cart.revision } })).status()).toBe(409);
    const current = await newer.json();
    const currentList = await request.get(`${ec}/api/shopping-lists/${garden.id}`).then(r => r.json());
    const bench = currentList.items.find((line: Line) => line.key === 'asset:bench_wood');
    const full = await request.put(`${ec}/api/cart/items/${bench.products[0].id}`, { data: { revision: result.cart.revision, quantity: 99 } });
    expect(full.ok()).toBeTruthy();
    const limit = await request.post(url, { data: { gardenRevision: current.revision, cartRevision: (await full.json()).revision,
      listRevision: currentList.listRevision,
      items: [{ key: bench.key, productId: bench.products[0].id }] } }).then(r => r.json());
    expect(limit.added).toHaveLength(0);
    expect(limit.skipped[0].code).toBe('QUANTITY_LIMIT');
    expect((await seller.delete(`${ec}/api/products/${product.id}`)).ok()).toBeTruthy();
    const archivedCart = await request.get(`${ec}/api/cart`).then(r => r.json());
    const archivedList = await request.get(`${ec}/api/shopping-lists/${garden.id}`).then(r => r.json());
    const archived = await request.post(url, { data: { gardenRevision: current.revision, cartRevision: archivedCart.revision,
      listRevision: archivedList.listRevision,
      items: [{ key: `product:${product.id}`, productId: product.id }] } }).then(r => r.json());
    expect(archived.skipped[0].code).toBe('PRODUCT_ARCHIVED');
    expect(archived.cart.revision).toBe(archivedCart.revision);
    await mkdir(evidence, { recursive: true });
    await writeFile(`${evidence}/partial-transfer.json`, JSON.stringify(result, null, 2));
    await request.delete(`${canvas}/gardens/${garden.id}`);
    expect((await request.get(`${ec}/api/shopping-lists/${garden.id}`)).status()).toBe(404);
  } finally {
    await request.delete(`${canvas}/gardens/${garden.id}`);
    await seller.delete(`${ec}/api/products/${product.id}`);
  }
});

test('autosave failure retains placements, blocks EC navigation and supports retry', async ({ page, request }) => {
  const garden = await seedGardenPhoto(page, (await createGarden(request, '障害')).id);
  try {
    await page.goto(`/gardens/${garden.id}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: '3D庭', exact: true }).click();
    await showProductsTab(page);
    await page.getByLabel('商品を検索', { exact: true }).fill('ベンチ');
    await page.route('**/api/gardens/' + garden.id, async route => {
      if (route.request().method() === 'PUT') await route.abort('failed');
      else await route.continue();
    });
    await drag(page, page.getByTestId('browse-canvas-bench'));
    await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 1 / 1');
    await expect(page.getByTestId('save-status')).toHaveText('保存できませんでした');
    await page.getByRole('tab', { name: /買い物リスト/ }).click();
    await expect(page.getByTestId('shopping-sync-status')).toContainText('ECへ未反映');
    expect((await loadGarden(request, garden.id)).objects).toHaveLength(0);
    await page.getByRole('button', { name: 'リストを確認', exact: true }).click();
    await expect(page).toHaveURL(new RegExp('/gardens/' + garden.id));
    await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 1 / 1');
    await page.unroute('**/api/gardens/' + garden.id);
    await page.locator('.editor-alert').getByRole('button', { name: '再試行', exact: true }).click();
    await saved(page, 1);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: '3D庭', exact: true }).click();
    await saved(page, 1);
    await page.getByRole('tab', { name: /買い物リスト/ }).click();
    await page.getByRole('button', { name: 'リストを確認', exact: true }).click();
    await expect(page).toHaveURL(`${ec}/cart?garden=${garden.id}`);
    await expect(page.getByRole('dialog', { name: '庭に設置したものから追加', exact: true })).toBeVisible();
    await expect(page.getByRole('checkbox')).toHaveCount(1);
    await expect(page.getByRole('checkbox')).not.toBeChecked();
    await mkdir(evidence, { recursive: true });
    await page.screenshot({ path: `${evidence}/recovered-shopping-list.png`, fullPage: true });
  } finally { await request.delete(`${canvas}/gardens/${garden.id}`); }
});

test('autosave revision conflict preserves the local placement and stops repeated overwrites', async ({ page, request }) => {
  const garden = await seedGardenPhoto(page, (await createGarden(request, '障害')).id);
  try {
    await page.goto(`/gardens/${garden.id}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: '3D庭', exact: true }).click();
    await expect(page.getByTestId('save-status')).toHaveText('保存済み');
    await showProductsTab(page);
    await page.getByLabel('商品を検索', { exact: true }).fill('ベンチ');
    const changed = await request.put(`${canvas}/gardens/${garden.id}`, { data: { ...garden, name: garden.name + ' 別画面更新' } });
    expect(changed.ok()).toBeTruthy();
    let attempts = 0;
    page.on('request', r => { if (r.method() === 'PUT' && r.url().endsWith('/api/gardens/' + garden.id)) attempts++; });
    await drag(page, page.getByTestId('browse-canvas-bench'));
    await expect(page.getByTestId('save-status')).toHaveText('保存できませんでした');
    await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 1 / 1');
    await page.waitForTimeout(1600);
    expect(attempts).toBe(1);
    const server = await loadGarden(request, garden.id);
    expect(server.objects).toHaveLength(0);
    expect(server.name).toContain('別画面更新');
    await page.getByRole('tab', { name: /買い物リスト/ }).click();
    await expect(page.getByTestId('shopping-sync-status')).toContainText('ECへ未反映');
    await page.screenshot({ path: `${evidence}/conflict-preserves-edit.png` });
    page.on('dialog', dialog => dialog.accept());
    await page.goto('/', { waitUntil: 'domcontentloaded' });
  } finally { await request.delete(`${canvas}/gardens/${garden.id}`); }
});

test('a full cart skips a new product without changing its existing fifty product lines', async ({ request, seller }) => {
  const { product, body } = await createProduct(request);
  const garden = await createGarden(request, 'A');
  const ids = [product.id];
  try {
    const saved = await request.put(`${canvas}/gardens/${garden.id}`, { data: { ...garden, objects: [object('bench_wood')] } }).then(r => r.json());
    let cart = await request.get(`${ec}/api/cart`).then(r => r.json());
    for (let i = 0; i < 50; i++) {
      const response = await seller.post(`${ec}/api/products`, { data: { ...body, plantModelProfile: null,
        name: 'カート上限検証-' + i, sku: 'SL-LIMIT-' + randomUUID().slice(0, 12) } });
      expect(response.ok()).toBeTruthy();
      const created = await response.json();
      ids.push(created.id);
      const added = await request.put(`${ec}/api/cart/items/${created.id}`, { data: { revision: cart.revision, quantity: 1 } });
      expect(added.ok()).toBeTruthy();
      cart = await added.json();
    }
    const list = await request.get(`${ec}/api/shopping-lists/${garden.id}`).then(r => r.json());
    const result = await request.post(`${ec}/api/cart/shopping-lists/${garden.id}/items`, {
      data: { gardenRevision: saved.revision, cartRevision: cart.revision, listRevision: list.listRevision, items: [{ key: 'asset:bench_wood', productId: 'canvas-bench' }] },
    }).then(r => r.json());
    expect(result.added).toHaveLength(0);
    expect(result.skipped[0].code).toBe('CART_LIMIT');
    expect(result.cart).toEqual(cart);
  } finally {
    await request.delete(`${canvas}/gardens/${garden.id}`);
    for (const id of ids) await seller.delete(`${ec}/api/products/${id}`);
  }
});

test('EC shows partial-add reasons and the shopping list fits a mobile screen', async ({ page, request, seller }) => {
  const { product, body } = await createProduct(request);
  const garden = await createGarden(request, 'A');
  try {
    const response = await request.put(`${canvas}/gardens/${garden.id}`, { data: { ...garden,
      objects: [object('plant_modular', 0, product), object('plant_modular', 1, product), object('bench_wood', 2)] } });
    expect(response.ok()).toBeTruthy();
    await page.goto(`${ec}/cart?garden=${garden.id}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('checkbox')).toHaveCount(2);
    await page.getByRole('button', { name: 'すべて選択', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: product.name + 'を選択', exact: true })).toBeChecked();
    expect((await seller.put(`${ec}/api/products/${product.id}`, { data: { ...body, stock: 1, expectedStock: body.stock } })).ok()).toBeTruthy();
    await page.getByRole('button', { name: '3点をカートに追加', exact: true }).click();
    await expect(page).toHaveURL(`${ec}/cart`);
    await expect(page.locator('.garden-transfer-result')).toContainText('1種類を追加しました');
    await expect(page.locator('.garden-transfer-result')).toContainText('在庫が不足');
    const cart = await page.request.get(`${ec}/api/cart`).then(r => r.json());
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0].product.id).toBe('canvas-bench');
    await mkdir(evidence, { recursive: true });
    await page.screenshot({ path: `${evidence}/ec-partial-result.png`, fullPage: true });
    await page.getByRole('button', { name: '庭から選び直す', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('checkbox', { name: product.name + 'を選択', exact: true })).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `${evidence}/mobile-shopping-list.png`, fullPage: true });
  } finally {
    await request.delete(`${canvas}/gardens/${garden.id}`);
    await seller.delete(`${ec}/api/products/${product.id}`);
  }
});

test('legacy placements with multiple candidates require an explicit purchase product and checkbox', async ({ page, request, seller }) => {
  const { product } = await createProduct(request);
  const garden = await createGarden(request, 'A');
  try {
    legacyCandidate(product.id);
    expect((await request.put(`${canvas}/gardens/${garden.id}`, { data: { ...garden, objects: [object('bench_wood')] } })).ok()).toBeTruthy();
    await page.goto(`${ec}/cart?garden=${garden.id}`, { waitUntil: 'domcontentloaded' });
    const check = page.getByRole('checkbox');
    await expect(check).toBeDisabled();
    await page.getByRole('combobox', { name: /の購入商品/ }).selectOption(product.id);
    await expect(check).toBeEnabled();
    await expect(check).not.toBeChecked();
    await check.check();
    await page.getByRole('button', { name: '1点をカートに追加', exact: true }).click();
    await expect(page).toHaveURL(`${ec}/cart`);
    const cart = await page.request.get(`${ec}/api/cart`).then(r => r.json());
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0].product.id).toBe(product.id);
    expect(cart.items[0].quantity).toBe(1);
  } finally {
    legacyCandidate(product.id, true);
    await request.delete(`${canvas}/gardens/${garden.id}`);
    await seller.delete(`${ec}/api/products/${product.id}`);
  }
});
