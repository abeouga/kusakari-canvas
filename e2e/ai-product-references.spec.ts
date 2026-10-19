import { expect, test, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import type { GardenObject, PlantComposition } from '../frontend/src/types/garden';
import { plantPresetsV3 } from '../scripts/plant-library-v3-presets.mjs';
import { productInput } from '../scripts/plant-library-presets.mjs';
import { capture, createScene, openScene, readGarden, syntheticPhoto } from './occlusion-helpers';

const api = (process.env.KUSAKARI_CANVAS_E2E_API_URL ? process.env.KUSAKARI_CANVAS_E2E_API_URL + '/api' : 'http://127.0.0.1:18081/api');
const ec = (process.env.KUSAKARI_EC_E2E_API_PORT ? 'http://127.0.0.1:' + process.env.KUSAKARI_EC_E2E_API_PORT + '/api' : 'http://127.0.0.1:18186/api');
const evidence = process.env.KUSAKARI_AI_PRODUCTS_EVIDENCE!;
test.skip(!evidence, 'Run with playwright.ai-products.config.ts and a dedicated evidence directory; four real services are required.');
type Product = { id: string; name: string; canvasMaterialCode: string; modelComposition: PlantComposition };
type Reference = { assetId: string; productId: string; productName: string; source: 'catalog' };
const fixtures: { productIds: string[]; gardenIds: string[]; cartIds: string[] } = { productIds: [], gardenIds: [], cartIds: [] };
async function recordFixtures() {
  await mkdir(evidence, { recursive: true });
  // Playwright replaces workers after failures; retain this run's earlier cleanup identities.
  try {
    const previous = JSON.parse(await readFile(`${evidence}/fixtures.json`, 'utf8'));
    fixtures.productIds = [...new Set([...previous.productIds, ...fixtures.productIds])];
    fixtures.cartIds = [...new Set([...previous.cartIds, ...fixtures.cartIds])];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await writeFile(`${evidence}/fixtures.json`, JSON.stringify(fixtures, null, 2));
}
test.afterEach(async ({ page }) => {
  for (const cookie of await page.context().cookies()) {
    if (cookie.name === 'kusakari_cart' && !fixtures.cartIds.includes(cookie.value)) fixtures.cartIds.push(cookie.value);
  }
  await recordFixtures();
});
async function product(request: APIRequestContext, key: string): Promise<Product> {
  const preset = plantPresetsV3.find((item) => item.key === key)!;
  const input = { ...productInput(preset, preset.imageUrl), sku: `AIREF-${randomUUID().slice(0, 12)}` };
  const response = await request.post(`${ec}/products`, { data: input });
  expect(response.status(), await response.text()).toBe(200);
  const created = await response.json() as Product;
  fixtures.productIds.push(created.id);
  await recordFixtures();
  return created;
}
function placement(item: Product, x: number, z: number): GardenObject {
  return { id: randomUUID(), assetId: 'plant_modular', productId: item.id, productName: item.name,
    materialCode: item.canvasMaterialCode, modelComposition: item.modelComposition,
    position: { x, y: 0, z }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } };
}

test('linked products are automatic, grouped by product, archived-readable and persisted without changing the garden', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const products = [await product(request, 'split-leaf'), await product(request, 'soft-grass')];
  try {
    const ids = products.map((item) => item.id);
    const metadata = await request.post(`${ec}/products/references`, { data: { productIds: ids } });
    expect(metadata.status()).toBe(200);
    expect((await metadata.json()).map((item: { id: string }) => item.id)).toEqual(ids);
    expect(await metadata.text()).not.toContain('modelComposition');
    expect((await request.post(`${ec}/products/references`, { data: { productIds: [ids[0], ids[0]] } })).status()).toBe(400);
    expect((await request.post(`${ec}/products/references`, { data: { productIds: [randomUUID()] } })).status()).toBe(404);
    expect((await request.delete(`${ec}/products/${ids[0]}`)).status()).toBe(200);
    const catalog = await request.get(`${ec}/products?storeId=1`).then((response) => response.json());
    expect(catalog.some((item: { id: string }) => item.id === ids[0])).toBe(false);
    const resolved = await request.post(`${api}/ai/product-references`, { data: { productIds: ids } });
    expect(resolved.status(), await resolved.text()).toBe(200);
    const references = await resolved.json();
    expect(references.map((item: { productId: string }) => item.productId)).toEqual(ids);
    expect(references.map((item: { active: boolean }) => item.active)).toEqual([false, true]);
    expect(references.every((item: { requiresUpload: boolean }) => !item.requiresUpload)).toBe(true);
    for (const item of references) {
      expect((await request.get(item.imageUrl)).status()).toBe(200);
    }
    expect((await request.post(`${api}/ai/product-references`, { data: { productIds: [randomUUID()] } })).status()).toBe(400);
    expect((await request.post(`${api}/ai/product-references`, { data: { productIds: [ids[0], ids[0]] } })).status()).toBe(400);
    const status = await request.get(`${api}/ai/status`).then((response) => response.json());
    expect(status.configured).toBe(false); // A real no-key response; never send a paid generation.
    await page.goto('/');
    const photo = await syntheticPhoto(page);
    const garden = await createScene(request, fixtures.gardenIds, photo,
      [placement(products[0], -2.8, 0), placement(products[0], 0, 0), placement(products[1], 2.8, 0)]);
    await recordFixtures();
    await openScene(page, garden);
    const captured = await capture(page);
    const section = page.getByRole('region', { name: 'AI完成イメージ生成' });
    await expect(section.locator('fieldset')).toHaveCount(0);
    await expect(section.getByRole('combobox')).toHaveCount(0);
    await expect(page.getByTestId('ai-input-count')).toContainText('入力画像 3 / 16枚・植物参考 2枚');
    await expect(page.getByTestId('generation-details')).not.toHaveAttribute('open');
    for (const item of products) {
      await expect(section.getByText(item.name, { exact: true })).toHaveCount(0);
    }
    const generate = section.getByRole('button', { name: 'AIで生成（API利用料が発生します）', exact: true });
    await expect(generate).toBeEnabled();
    await page.screenshot({ path: `${evidence}/compact-generation-dialog.png` });
    await expect(generate).toBeInViewport();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(generate).toBeInViewport();
    await expect(section.getByTestId('before-image')).toBeInViewport();
    await page.screenshot({ path: `${evidence}/compact-generation-mobile.png` });
    await page.setViewportSize({ width: 1440, height: 1000 });
    const sent = page.waitForRequest((req) => req.url().endsWith('/ai-image') && req.method() === 'POST');
    const responsePending = page.waitForResponse((res) => res.url().endsWith('/ai-image') && res.request().method() === 'POST');
    await generate.click();
    const payload = (await sent).postDataJSON();
    expect((await responsePending).status()).toBe(503);
    await expect(section.getByRole('alert')).toContainText('APIキーが設定されていません');
    expect(payload.references).toEqual([...new Set(garden.objects.map((item) => item.productId))]
      .map((id) => ({ assetId: 'plant_modular', productId: id })));
    expect(payload.document).toEqual(garden);
    await writeFile(`${evidence}/generation-request.json`, JSON.stringify(payload, null, 2));
    const pipelineEvidence = `${evidence}/pipeline-${garden.id}`;
    await mkdir(pipelineEvidence, { recursive: true });
    await writeFile(`${pipelineEvidence}/generation-request.json`, JSON.stringify(payload, null, 2));
    execFileSync(process.cwd() + '/backend/.venv/Scripts/python.exe', ['-m', 'verification.verify_product_reference_pipeline',
      '--output-dir', pipelineEvidence], { cwd: process.cwd() + '/backend', stdio: 'pipe' });
    for (const invalid of [[payload.references[0], payload.references[0]],
      [payload.references[0], { assetId: 'plant_modular', productId: randomUUID() }]]) {
      // Uvicorn can close an idle keep-alive while the separate image-byte validation runs.
      // Retry connection resets only on these deliberately invalid, non-generating requests.
      const denied = await request.post(`${api}/gardens/${garden.id}/ai-image`,
        { data: { ...payload, references: invalid }, maxRetries: 1 });
      expect(denied.status()).toBe(400);
      expect(['AI_DUPLICATE_REFERENCE', 'AI_REFERENCE_MISMATCH']).toContain((await denied.json()).code);
    }
    // Artificial images exercise persistence only, not AI image quality or provider success.
    const summary: Reference[] = products.map((item) => ({ assetId: 'plant_modular', productId: item.id,
      productName: item.name, source: 'catalog' }));
    const history = { id: randomUUID(), document: garden, beforeDataUrl: captured.before, afterDataUrl: photo.dataUrl,
      model: status.model, quality: status.quality, generationMethod: 'full_frame_v1', inputImageCount: 3, referenceSummary: summary };
    const historyUrl = `${api}/gardens/${garden.id}/image-history`;
    const saved = await request.post(historyUrl, { data: history });
    expect(saved.status(), await saved.text()).toBe(200);
    expect((await request.post(historyUrl, { data: history })).status()).toBe(200);
    const detail = await request.get(`${historyUrl}/${history.id}`).then((res) => res.json());
    expect(detail.referenceSummary).toEqual(summary);
    expect(detail.document).toEqual(garden);
    const wrong = await request.post(historyUrl, { data: { ...history, id: randomUUID(),
      referenceSummary: [summary[0], { ...summary[1], productId: randomUUID() }] } });
    expect(wrong.status()).toBe(400);
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 3 / 3');
    await expect(page.getByTestId(`browse-${ids[1]}`)).toBeVisible();
    expect(await readGarden(request, garden.id)).toEqual(garden);
    await page.screenshot({ path: `${evidence}/reloaded.png` });
    await writeFile(`${evidence}/reloaded-garden.json`, JSON.stringify(garden, null, 2));
    await page.getByTestId('completion-menu-toggle').click();
    await page.getByRole('button', { name: '生成履歴', exact: true }).click();
    await page.getByTestId(`history-item-${history.id}`).getByRole('button', { name: '比較する' }).click();
    const selected = page.getByRole('region', { name: '選択した生成履歴' });
    await expect(selected.getByTestId('comparison-after')).toHaveAttribute('src', history.afterDataUrl);
    await page.keyboard.press('Escape');
    // Fault injection only: block real network, then recover against the actual API.
    await page.route('**/api/ai/product-references', (route) => route.abort('connectionrefused'));
    await page.reload();
    await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 3 / 3');
    await capture(page);
    await expect(section.getByRole('button', { name: '登録画像を再取得' })).toBeVisible();
    await expect(generate).toBeDisabled();
    await page.unroute('**/api/ai/product-references');
    await section.getByRole('button', { name: '登録画像を再取得' }).click();
    await expect(generate).toBeEnabled();
    await expect(section.locator('fieldset')).toHaveCount(0);
    expect(errors).toEqual([]);
    await writeFile(`${evidence}/checks.json`, JSON.stringify({ automaticReferences: 2, placements: 3,
      duplicateGrouped: true, archivedReadable: true, mismatchRejected: true, historyReloaded: true,
      connectionRetry: true, gardenUnchanged: true, paidGenerationCalls: 0, errors }, null, 2));
  } finally {
    for (const id of fixtures.gardenIds) expect((await request.delete(`${api}/gardens/${id}`)).status()).toBe(204);
    fixtures.gardenIds = [];
    for (const item of products) expect((await request.delete(`${ec}/products/${item.id}`)).status()).toBe(200);
    await recordFixtures();
  }
});

test('a saved unlinked legacy tree has a clear replacement notice, without a product selector', async ({ page, request }) => {
  await page.goto('/');
  const photo = await syntheticPhoto(page);
  const garden = await createScene(request, fixtures.gardenIds, photo, [{ id: randomUUID(), assetId: 'tree_oak',
    position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }]);
  await recordFixtures();
  try {
    await openScene(page, garden);
    await capture(page);
    const section = page.getByRole('region', { name: 'AI完成イメージ生成' });
    await expect(section.getByRole('alert')).toContainText('商品に紐づいていない旧モデル（木）');
    await expect(section.getByRole('combobox')).toHaveCount(0);
    await expect(section.getByRole('button', { name: 'AIで生成（API利用料が発生します）' })).toBeDisabled();
    expect(await readGarden(request, garden.id)).toEqual(garden);
  } finally {
    expect((await request.delete(`${api}/gardens/${garden.id}`)).status()).toBe(204);
    fixtures.gardenIds = [];
    await recordFixtures();
  }
});
