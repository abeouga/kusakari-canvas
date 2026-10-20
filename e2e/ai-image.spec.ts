import { createTestProduct, productPlacement } from './catalog-fixture';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { api } from './api-url.js';
import { artifacts, capture, compare, createScene, expectSameImage, openScene, readGarden,
  removeScenes, shrub, syntheticPhoto } from './occlusion-helpers.js';
import type { GardenDocument } from '../frontend/src/types/garden.js';

type Bounds = { x: number; y: number; width: number; height: number };
type Layout = { placementId: string; assetId: string; measurement: string; visibility: string;
  bounds: Bounds | null; visibleBounds: Bounds | null; anchor: { x: number; y: number } | null };
type GenerationPayload = {
  document: GardenDocument;
  beforeDataUrl: string;
  coverageDataUrl: string;
  layout: Layout[];
  storeId: number;
  references: { assetId: string; productId: string; photoDataUrl?: string }[];
};

async function addReference(page: Page) {
  const source = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#eeeecc';
    context.fillRect(0, 0, 128, 128);
    context.fillStyle = '#538942';
    context.beginPath();
    context.arc(64, 58, 42, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#765539';
    context.fillRect(60, 90, 8, 30);
    return canvas.toDataURL('image/png');
  });
  const input = page.getByRole('group', { name: '低木の参考写真', exact: true }).getByLabel('写真を選択');
  await input.setInputFiles({ name: 'synthetic-reference.png', mimeType: 'image/png',
    buffer: Buffer.from(source.split(',')[1], 'base64') });
  await expect(page.getByAltText('低木の選択した参考写真')).toBeVisible();
}

async function generateWithoutKey(page: Page) {
  const pending = page.waitForRequest((request) => request.method() === 'POST' && request.url().endsWith('/ai-image'));
  await page.getByRole('button', { name: 'AIで生成（API利用料が発生します）', exact: true }).click();
  const outgoing = await pending;
  const response = await outgoing.response();
  expect(response?.status()).toBe(503);
  expect((await response!.json()).code).toBe('AI_NOT_CONFIGURED');
  await expect(page.getByRole('region', { name: 'AI完成イメージ生成' }).getByRole('alert')).toContainText('APIキーが設定されていません');
  return outgoing.postDataJSON() as GenerationPayload;
}

async function measureCoverage(page: Page, payload: GenerationPayload) {
  return page.evaluate(async ({ beforeDataUrl, coverageDataUrl }) => {
    async function decode(source: string) {
      const image = new Image();
      image.src = source;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      return { width: canvas.width, height: canvas.height,
        pixels: context.getImageData(0, 0, canvas.width, canvas.height).data };
    }
    const before = await decode(beforeDataUrl);
    const coverage = await decode(coverageDataUrl);
    let plants = 0;
    let furniture = 0;
    let transparent = 0;
    let blue = 0;
    let top = 0;
    let bottom = 0;
    let left = coverage.width;
    let right = -1;
    let firstRow = coverage.height;
    let lastRow = -1;
    for (let index = 0; index < coverage.pixels.length; index += 4) {
      if (coverage.pixels[index] > 2) plants++;
      if (coverage.pixels[index + 1] > 2) furniture++;
      if (coverage.pixels[index + 2] !== 0) blue++;
      if (coverage.pixels[index + 3] !== 255) transparent++;
      if (coverage.pixels[index] > 2) {
        const row = Math.floor(index / 4 / coverage.width);
        const column = (index / 4) % coverage.width;
        left = Math.min(left, column);
        right = Math.max(right, column);
        firstRow = Math.min(firstRow, row);
        lastRow = Math.max(lastRow, row);
        if (row < coverage.height / 2) top++;
        else bottom++;
      }
    }
    const cornersBlack = [0, coverage.width - 1,
      (coverage.height - 1) * coverage.width, coverage.height * coverage.width - 1].every((pixel) =>
      coverage.pixels[pixel * 4] === 0 && coverage.pixels[pixel * 4 + 1] === 0);
    return { width: coverage.width, height: coverage.height, beforeWidth: before.width,
      beforeHeight: before.height, plants, furniture, transparent, blue, top, bottom, cornersBlack,
      plantBounds: { x: left, y: firstRow, width: right - left + 1, height: lastRow - firstRow + 1 } };
  }, payload);
}

test('AI generation uses real EC selection, captures plant/furniture coverage, and reports a missing key without changing the garden', async ({ page, request }) => {
  const ids: string[] = [];
  try {
    const status = await request.get(`${api}/ai/status`);
    expect(status.status()).toBe(200);
    expect(await status.json()).toEqual({ configured: false, model: 'gpt-image-2.5-sunburst', quality: 'medium' });
    const photo = await syntheticPhoto(page, 1201, 801);
    const product = await createTestProduct(request, '低木');
    const plant = productPlacement(product, 0.3, -1.8, 1.2);
    const bench = { ...shrub(0, 1, 2), assetId: 'bench_wood' };
    const garden = await createScene(request, ids, photo, [plant, bench]);
    await openScene(page, garden);
    await page.getByTestId('object-row-0').click();
    await page.getByRole('checkbox', { name: '配置', exact: true }).uncheck();
    const baseline = await capture(page);
    await expect(page.getByTestId('ai-result-guidance')).toContainText('庭全体のAfter画像を生成');
    await expect(page.getByTestId('ai-result-guidance')).toContainText('背景や家具も含め');
    await expect(page.getByRole('combobox', { name: '低木に対応する商品', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'AIで生成（API利用料が発生します）', exact: true }).click();
    await expect(page.getByRole('region', { name: 'AI完成イメージ生成' }).getByRole('alert')).toContainText('参考写真を追加');
    await page.getByRole('group', { name: '低木の参考写真', exact: true }).getByLabel('写真を選択').setInputFiles({
      name: 'invalid.png', mimeType: 'image/png', buffer: Buffer.from('<svg></svg>') });
    await expect(page.getByRole('region', { name: 'AI完成イメージ生成' }).getByRole('alert')).toContainText('形式と内容が一致しません');
    await addReference(page);
    const payload = await generateWithoutKey(page);
    expect(payload.document).toEqual(garden);
    expect(payload.beforeDataUrl).toBe(baseline.before);
    expect(payload.references).toHaveLength(1);
    expect(payload.references[0].productId).toBe(product.id);
    expect(payload.references[0].photoDataUrl).toMatch(/^data:image\/png;base64,/);
    const coverage = await measureCoverage(page, payload);
    expect(coverage.width).toBe(photo.imageWidth);
    expect(coverage.height).toBe(photo.imageHeight);
    expect(coverage.beforeWidth).toBe(photo.imageWidth);
    expect(coverage.beforeHeight).toBe(photo.imageHeight);
    expect(coverage.plants).toBeGreaterThan(500);
    expect(coverage.furniture).toBeGreaterThan(500);
    expect(coverage.transparent).toBe(0);
    expect(coverage.blue).toBe(0);
    expect(coverage.cornersBlack).toBe(true);
    // This fixture projects the plant into the upper half. A vertical flip would move it below.
    expect(coverage.top).toBeGreaterThan(coverage.bottom);
    expect(payload.layout).toHaveLength(2);
    const plantLayout = payload.layout.find((item) => item.placementId === plant.id)!;
    const benchLayout = payload.layout.find((item) => item.placementId === bench.id)!;
    // Occlusion analysis was retired with Image Studio. The projected envelope
    // must still contain the actual plant pixels, without claiming visibility.
    expect(plantLayout.measurement).toBe('projected_box');
    expect(plantLayout.visibility).toBe('unknown');
    expect(plantLayout.visibleBounds).toBeNull();
    expect(plantLayout.bounds!.x).toBeLessThanOrEqual(coverage.plantBounds.x);
    expect(plantLayout.bounds!.y).toBeLessThanOrEqual(coverage.plantBounds.y);
    expect(plantLayout.bounds!.x + plantLayout.bounds!.width)
      .toBeGreaterThanOrEqual(coverage.plantBounds.x + coverage.plantBounds.width);
    expect(plantLayout.bounds!.y + plantLayout.bounds!.height)
      .toBeGreaterThanOrEqual(coverage.plantBounds.y + coverage.plantBounds.height);
    expect(plantLayout.anchor).not.toBeNull();
    expect(benchLayout.measurement).toBe('projected_box');
    expect(benchLayout.visibility).toBe('unknown');
    expect(benchLayout.bounds!.width).toBeGreaterThan(0);
    const invalidLayouts = [
      [], [...payload.layout, plantLayout],
      payload.layout.map((item) => ({ ...item, assetId: 'unknown_asset' })),
      payload.layout.map((item) => ({ ...item, placementId: '00000000-0000-0000-0000-000000000001' })),
      payload.layout.map((item) => ({ ...item, bounds: { x: photo.imageWidth, y: 0, width: 1, height: 1 } })),
      payload.layout.map((item) => ({ ...item, bounds: { x: 0, y: 0, width: -1, height: 1 } })),
      payload.layout.map((item) => ({ ...item, visibility: 'invalid' })),
      payload.layout.map((item) => ({ ...item, measurement: 'raster', visibility: 'visible', visibleBounds: null })),
      payload.layout.map((item) => ({ ...item, measurement: 'projected_box', visibility: 'partial' })),
    ];
    for (const layout of invalidLayouts) {
      const invalid = await request.post(`${api}/gardens/${garden.id}/ai-image`, { data: { ...payload, layout } });
      expect(invalid.status()).toBe(400);
    }
    const missingLayout = { ...payload } as Partial<GenerationPayload>;
    delete missingLayout.layout;
    expect((await request.post(`${api}/gardens/${garden.id}/ai-image`, { data: missingLayout })).status()).toBe(400);
    await expect(page.getByTestId('after-image')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('object-row-0')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('checkbox', { name: '配置', exact: true })).not.toBeChecked();
    expect(await readGarden(request, garden.id)).toEqual(garden);
    await page.reload();
    await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 2 / 2');
    const reloaded = await capture(page);
    expectSameImage(await compare(page, baseline.before, reloaded.before, photo.dataUrl));
    expect(await readGarden(request, garden.id)).toEqual(garden);
    await mkdir(artifacts, { recursive: true });
    await writeFile(resolve(artifacts, 'ai-preflight-garden.json'), JSON.stringify(garden, null, 2));
    await writeFile(resolve(artifacts, 'ai-preflight-metrics.json'), JSON.stringify(coverage, null, 2));
    await writeFile(resolve(artifacts, 'ai-preflight-coverage.png'), Buffer.from(payload.coverageDataUrl.split(',')[1], 'base64'));
    await page.screenshot({ path: resolve(artifacts, 'ai-preflight-reloaded.png'), fullPage: true });
    await writeFile(resolve(artifacts, 'ai-layout-preflight.json'), JSON.stringify({
      layout: payload.layout, invalidRequestsRejected: invalidLayouts.length + 1, gardenUnchanged: true,
    }, null, 2));
  } finally { await removeScenes(request, ids); }
});

test('AI capture no longer exposes or creates occlusion supplements', async ({ page, request }) => {
  const ids: string[] = [];
  try {
    const photo = await syntheticPhoto(page, 1200, 800);
    const garden = await createScene(request, ids, photo, [shrub(0, 0)]);
    await openScene(page, garden);
    await capture(page);
    await expect(page.getByText('遮蔽補助画像を含める', { exact: true })).toHaveCount(0);
    await expect(page.getByText(/遮蔽補助画像/)).toHaveCount(0);
    await expect(page.locator('[data-testid^="supplement-"]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 1 / 1');
    expect(await readGarden(request, garden.id)).toEqual(garden);
    await page.screenshot({ path: resolve(artifacts, 'ai-without-occlusion-supplements-reloaded.png'), fullPage: true });
    await writeFile(resolve(artifacts, 'ai-without-occlusion-supplements-garden.json'), JSON.stringify(garden, null, 2));
  } finally { await removeScenes(request, ids); }
});

test('coverage copy failure restores rendering and allows a complete retry', async ({ page, request }) => {
  const ids: string[] = [];
  try {
    const photo = await syntheticPhoto(page);
    const garden = await createScene(request, ids, photo, [shrub(0, 0)]);
    await openScene(page, garden);
    const baseline = await capture(page);
    await page.keyboard.press('Escape');
    await page.getByTestId('object-row-0').click();
    await page.getByRole('checkbox', { name: '配置', exact: true }).uncheck();
    await page.evaluate(() => {
      const original = CanvasRenderingContext2D.prototype.drawImage;
      let copies = 0;
      CanvasRenderingContext2D.prototype.drawImage = function (source: CanvasImageSource, ...values: number[]) {
        if (source instanceof HTMLCanvasElement && source.matches('.photo-models canvas')) {
          copies++;
          if (copies === 2) {
            CanvasRenderingContext2D.prototype.drawImage = original;
            throw new Error('E2E coverage copy failure');
          }
        }
        return Reflect.apply(original, this, [source, ...values]);
      };
    });
    await page.getByRole('button', { name: /^(AI生成|完成イメージ)メニュー$/ }).click();
    if (!await page.getByRole('button', { name: '完成イメージを確認', exact: true }).isVisible()) await page.getByRole('button', { name: /^(AI生成|完成イメージ)メニュー$/ }).click();
    await page.getByRole('button', { name: '完成イメージを確認', exact: true }).click();
    await expect(page.getByTestId('completion-launcher').getByRole('alert')).toContainText('E2E coverage copy failure');
    const retry = await capture(page);
    expectSameImage(await compare(page, baseline.before, retry.before, photo.dataUrl), true);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('object-row-0')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('checkbox', { name: '配置', exact: true })).not.toBeChecked();
    await page.reload();
    await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 1 / 1');
    expect(await readGarden(request, garden.id)).toEqual(garden);
    await writeFile(resolve(artifacts, 'ai-coverage-retry-garden.json'), JSON.stringify(garden, null, 2));
    await page.screenshot({ path: resolve(artifacts, 'ai-coverage-retry-reloaded.png'), fullPage: true });
  } finally { await removeScenes(request, ids); }
});
