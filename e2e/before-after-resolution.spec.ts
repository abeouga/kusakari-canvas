import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { api } from './api-url';
import { createScene, openScene, readGarden, removeScenes, shrub, syntheticPhoto } from './occlusion-helpers';

const evidence = process.env.KUSAKARI_BEFORE_AFTER_EVIDENCE!;
test.skip(!evidence, 'Use playwright.before-after.config.ts with dedicated MySQL and offline image fixtures.');
type Fixture = { width: number; height: number; providerSize: [number, number];
  beforeDataUrl: string; afterDataUrl: string; highResolutionDataUrl: string };
const fixtures = { productIds: [] as string[], gardenIds: [] as string[], cartIds: [] as string[] };
async function recordFixtures() {
  await mkdir(evidence, { recursive: true });
  try {
    const previous = JSON.parse(await readFile(`${evidence}/fixtures.json`, 'utf8'));
    fixtures.cartIds = [...new Set([...previous.cartIds, ...fixtures.cartIds])];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await writeFile(`${evidence}/fixtures.json`, JSON.stringify(fixtures, null, 2));
}
test.afterEach(async ({ page, request }) => {
  for (const cookie of await page.context().cookies()) {
    if (cookie.name === 'kusakari_cart') fixtures.cartIds.push(cookie.value);
  }
  await removeScenes(request, fixtures.gardenIds);
  fixtures.gardenIds = [];
  await recordFixtures();
});

for (const index of [0, 1, 2]) test(`whole-frame history at resolution case ${index}: storage, reload, slider and narrow screen`, async ({ page, request }) => {
  const input: Fixture[] = JSON.parse(await readFile(resolve(evidence, '../pixels/fixtures.json'), 'utf8'));
  const fixture = input[index];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  let generationRequests = 0;
  page.on('request', outgoing => { if (outgoing.url().endsWith('/ai-image')) generationRequests++; });
  const photo = { ...await syntheticPhoto(page, fixture.width, fixture.height), dataUrl: fixture.beforeDataUrl };
  const garden = await createScene(request, fixtures.gardenIds, photo, [shrub(0, 0)]);
  await recordFixtures();
  const url = `${api}/gardens/${garden.id}/image-history`;
  // The After fixture went through the real full-frame normalizer, not an AI provider.
  const payload = { id: randomUUID(), document: garden, beforeDataUrl: fixture.beforeDataUrl,
    afterDataUrl: fixture.afterDataUrl, model: 'gpt-image-2.5-sunburst', quality: 'medium',
    generationMethod: 'full_frame_v3', inputImageCount: 2,
    referenceSummary: [{ assetId: 'shrub_boxwood', productId: 'resolution-fixture',
      productName: 'E2E geometry fixture', source: 'uploaded' }] };
  const saved = await request.post(url, { data: payload });
  expect(saved.status(), await saved.text()).toBe(200);
  const savedMeta = await saved.json();
  expect(savedMeta.generationMethod).toBe('full_frame_v3');
  expect([savedMeta.width, savedMeta.height]).toEqual(fixture.providerSize);
  for (const legacy of ['masked_composite_v1', 'full_frame_v1', 'full_frame_v2']) {
    expect((await request.post(url, { data: { ...payload, id: randomUUID(), generationMethod: legacy } })).status()).toBe(400);
  }
  await openScene(page, garden);
  await page.reload();
  await page.getByTestId('completion-menu-toggle').click();
  await page.getByRole('button', { name: '生成履歴', exact: true }).click();
  await page.getByTestId(`history-item-${payload.id}`).getByRole('button', { name: '比較する' }).click();
  await expect(page.getByTestId('generation-method-details')).toHaveAttribute('data-generation-method', 'full_frame_v3');
  const before = page.getByTestId('comparison-before');
  const after = page.getByTestId('comparison-after');
  await expect(after).toHaveAttribute('src', fixture.afterDataUrl);
  await expect(after).toHaveCSS('object-fit', 'contain');
  expect(await before.evaluate((image: HTMLImageElement) => [image.naturalWidth, image.naturalHeight])).toEqual([fixture.width, fixture.height]);
  expect(await after.evaluate((image: HTMLImageElement) => [image.naturalWidth, image.naturalHeight])).toEqual(fixture.providerSize);
  expect(await before.boundingBox()).toEqual(await after.boundingBox());
  const samples = await after.evaluate(async (image: HTMLImageElement) => {
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    return [[.1, .1], [.9, .1], [.1, .9], [.9, .9], [.5, .5]].map(([x, y]) =>
      Array.from(context.getImageData(Math.round(x * (canvas.width - 1)), Math.round(y * (canvas.height - 1)), 1, 1).data));
  });
  expect(samples).toEqual([[220, 40, 40, 255], [40, 190, 70, 255], [40, 80, 220, 255], [240, 200, 40, 255], [25, 200, 205, 255]]);
  const range = page.getByRole('slider', { name: 'Before／Afterの比較位置', exact: true });
  await range.focus();
  await range.press('Home');
  await expect(range).toHaveValue('0');
  await expect(before).toHaveCSS('clip-path', 'inset(0px 100% 0px 0px)');
  await page.locator('.before-after-frame').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${evidence}/case-${index}-reloaded-after.png` });
  await range.press('End');
  await expect(range).toHaveValue('100');
  await range.press('Home');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.before-after-frame').scrollIntoViewIfNeeded();
  expect(await before.boundingBox()).toEqual(await after.boundingBox());
  expect((await after.boundingBox())!.width).toBeLessThan(390);
  await page.screenshot({ path: `${evidence}/case-${index}-narrow-after.png` });
  const downloadPending = page.waitForEvent('download');
  await page.getByRole('link', { name: 'After画像をPNGで保存', exact: true }).click();
  const download = await downloadPending;
  const path = `${evidence}/case-${index}-download.png`;
  await download.saveAs(path);
  expect(await readFile(path)).toEqual(Buffer.from(fixture.afterDataUrl.split(',')[1], 'base64'));
  // Isolated display stress check: replace only the decoded image, never the API response.
  // Persisted API images have matching sizes, but the reusable display must also fit a higher-res image.
  await after.evaluate(async (image: HTMLImageElement, source) => { image.src = source; await image.decode(); }, fixture.highResolutionDataUrl);
  expect(await after.evaluate((image: HTMLImageElement) => [image.naturalWidth, image.naturalHeight])).toEqual(fixture.providerSize);
  expect(await before.boundingBox()).toEqual(await after.boundingBox());
  await expect(after).toHaveCSS('object-fit', 'contain');
  await page.locator('.before-after-frame').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${evidence}/case-${index}-mixed-resolution-display.png` });
  const detail = await request.get(`${url}/${payload.id}`).then(response => response.json());
  expect(detail.afterDataUrl).toBe(fixture.afterDataUrl);
  expect(detail.document).toEqual(garden);
  expect(await readGarden(request, garden.id)).toEqual(garden);
  await writeFile(`${evidence}/case-${index}-reloaded-garden.json`, JSON.stringify(garden, null, 2));
  expect(generationRequests).toBe(0);
  expect(errors).toEqual([]);
});
