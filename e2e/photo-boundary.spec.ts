import { selectTestPlant } from './catalog-fixture';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Page, type APIRequestContext } from './test.js';
import { api as apiBase } from './api-url.js';
import type { GardenDocument } from '../frontend/src/types/garden.js';

const artifactDirectory = resolve('artifacts/e2e');
const corners = [[0.1, 0.85], [0.9, 0.85], [0.8, 0.2], [0.2, 0.2]];
const outline = [[0.15, 0.8], [0.8, 0.8], [0.75, 0.55], [0.65, 0.55], [0.6, 0.25], [0.25, 0.25]];
let createdGardenIds: string[] = [];

test.beforeEach(() => { createdGardenIds = []; });
test.afterEach(async ({ request }) => {
  for (const id of createdGardenIds) {
    expect([204, 404]).toContain((await request.delete(`${apiBase}/gardens/${id}`)).status());
  }
});

async function preparePhoto(page: Page) {
  await page.goto('/');
  await page.getByLabel('庭の名前').fill(`E2E photo boundary ${Date.now()}`);
  await page.getByRole('button', { name: '庭を作成' }).click();
  await page.waitForURL(/\/gardens\//);
  const id = new URL(page.url()).pathname.split('/').at(-1)!;
  createdGardenIds.push(id);
  await expect(page.getByTestId('save-status')).toHaveText('保存済み');
  await page.getByRole('button', { name: '写真＋設計' }).click();
  const imageDataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 800; canvas.height = 600;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#708e91'; context.fillRect(0, 0, 800, 600);
    context.fillStyle = '#647744';
    context.beginPath(); context.moveTo(80, 520); context.lineTo(720, 520); context.lineTo(640, 100); context.lineTo(160, 100); context.fill();
    return canvas.toDataURL('image/png');
  });
  await page.getByLabel('庭の写真を選択').setInputFiles({ name: 'garden.png', mimeType: 'image/png', buffer: Buffer.from(imageDataUrl.split(',')[1], 'base64') });
  await expect(page.locator('.photo-stage image')).toBeVisible();
  return { id, imageDataUrl };
}

async function screenPoint(page: Page, x: number, y: number) {
  return page.locator('.photo-stage').evaluate((element, coords) => {
    const screen = new DOMPoint(coords.x * 800, coords.y * 600).matrixTransform((element as SVGSVGElement).getScreenCTM()!);
    return { x: screen.x, y: screen.y };
  }, { x, y });
}

// 確定済みの頂点は「輪郭と寸法」の編集中だけ表示される。
async function showOutline(page: Page) {
  await page.locator('svg.photo-stage').waitFor();
  const mode = page.getByRole('button', { name: '輪郭と寸法' });
  if (await mode.isVisible() && await mode.getAttribute('aria-pressed') !== 'true') await mode.click();
}

async function clickImage(page: Page, x: number, y: number) {
  const point = await screenPoint(page, x, y);
  await page.mouse.click(point.x, point.y);
}

async function moveImage(page: Page, x: number, y: number) {
  const point = await screenPoint(page, x, y);
  await page.mouse.move(point.x, point.y);
  await expect.poll(async () => page.getByTestId('photo-preview-edge').evaluate((element, target) => {
    const line = element as SVGLineElement;
    const end = new DOMPoint(line.x2.baseVal.value, line.y2.baseVal.value).matrixTransform(line.getScreenCTM()!);
    return Math.hypot(end.x - target.x, end.y - target.y);
  }, point)).toBeLessThan(2);
}

async function gardenJson(request: APIRequestContext, id: string): Promise<GardenDocument> {
  const response = await request.get(`${apiBase}/gardens/${id}`);
  expect(response.ok()).toBeTruthy();
  return await response.json() as GardenDocument;
}

async function saveArtifact(request: APIRequestContext, id: string, name: string) {
  const document = await gardenJson(request, id);
  await mkdir(artifactDirectory, { recursive: true });
  await writeFile(resolve(artifactDirectory, name), `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  return document;
}

// WebGL antialiasing can round a color channel by one level on identical frames.
// Decode pixels instead of comparing PNG bytes; any larger visual change still fails.
async function maximumPixelDifference(page: Page, before: Buffer, after: Buffer) {
  return page.evaluate(async (images) => {
    const pixels = await Promise.all(images.map(async (data) => {
      const image = new Image();
      image.src = 'data:image/png;base64,' + data;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      return { width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data };
    }));
    if (pixels[0].width !== pixels[1].width || pixels[0].height !== pixels[1].height) return 255;
    let difference = 0;
    for (let index = 0; index < pixels[0].data.length; index++)
      difference = Math.max(difference, Math.abs(pixels[0].data[index] - pixels[1].data[index]));
    return difference;
  }, [before.toString('base64'), after.toString('base64')]);
}

test('I. 仮線追従・始点で6点輪郭確定・配置・保存復元・3D切替', async ({ page, request }) => {
  const { id, imageDataUrl } = await preparePhoto(page);
  await expect(page.getByTestId('photo-ground')).toHaveCount(0);
  await expect(page.getByTestId('save-status')).toHaveText('輪郭を描画中');
  await expect(page.getByRole('button', { name: '3D庭', exact: true })).toBeDisabled();
  await expect(page.getByTestId('save-status')).toHaveText('輪郭を描画中');
  await expect(page.locator('.photo-stage circle[fill="#ffbd68"]')).toHaveCount(0);
  await clickImage(page, ...outline[0] as [number, number]);
  await moveImage(page, 0.5, 0.72);
  const previousEnd = await page.getByTestId('photo-preview-edge').getAttribute('x2');
  await moveImage(page, 0.7, 0.65);
  expect(await page.getByTestId('photo-preview-edge').getAttribute('x2')).not.toBe(previousEnd);
  await showOutline(page);
  await expect(page.locator('.photo-stage circle[fill="#ffbd68"]')).toHaveCount(1);
  for (const [index, [x, y]] of outline.slice(1).entries()) {
    await clickImage(page, x, y);
    if (index === 2) {
      await showOutline(page);
      await expect(page.locator('.photo-stage circle[fill="#ffbd68"]')).toHaveCount(4);
      await expect(page.getByTestId('photo-ground')).toHaveCount(0);
      await expect(page.getByTestId('save-status')).toHaveText('輪郭を描画中');
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await moveImage(page, 0.45, 0.45);
  await page.screenshot({ path: resolve(artifactDirectory, 'garden-photo-boundary-draft.png'), fullPage: true });
  expect((await gardenJson(request, id)).photo).toBeNull();
  const start = page.getByRole('button', { name: '始点につないで輪郭を確定' });
  await start.hover();
  const firstX = await start.getAttribute('cx');
  await expect(page.getByTestId('photo-preview-edge')).toHaveAttribute('x2', firstX!);
  await start.click();
  await expect(page.getByTestId('photo-ground')).toBeVisible();
  await expect(page.getByTestId('photo-preview-edge')).toHaveCount(0);
  await showOutline(page);
  await expect(page.locator('.photo-stage circle[fill="#ffbd68"]')).toHaveCount(6);
  await expect(page.getByRole('button', { name: '輪郭を確定', exact: true })).toHaveCount(0);
  await selectTestPlant(page);
  await clickImage(page, 0.5, 0.65);
  await expect(page.getByTestId('object-row-0')).toBeVisible();
  await expect(page.getByTestId('save-status')).toHaveText('保存済み');
  const stored = await saveArtifact(request, id, 'garden-photo-polygon.json');
  expect(stored.photo?.corners).toHaveLength(4);
  expect(stored.photo?.boundary).toHaveLength(6);
  expect(stored.photo?.dataUrl).toBe(imageDataUrl);
  expect(stored.objects).toHaveLength(1);
  await page.reload();
  await expect(page.getByRole('button', { name: '写真＋設計' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.photo-stage image')).toBeVisible();
  await showOutline(page);
  await expect(page.locator('.photo-stage circle[fill="#ffbd68"]')).toHaveCount(6);
  await expect(page.getByTestId('photo-ground')).toBeVisible();
  await page.screenshot({ path: resolve(artifactDirectory, 'garden-photo-polygon.png'), fullPage: true });
  await page.getByRole('button', { name: '3D庭', exact: true }).click();
  await expect(page.locator('.photo-stage')).toHaveCount(0);
  await expect(page.getByTestId('garden-canvas')).toBeVisible();
  await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 1 / 1');
  const canvas = page.locator('[data-testid="garden-canvas"] canvas');
  const beforeOrbit = await canvas.screenshot();
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('3Dキャンバスが表示されていません。');
  await page.mouse.move(bounds.x + bounds.width * 0.75, bounds.y + bounds.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.55, bounds.y + bounds.height * 0.5, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await canvas.screenshot()).equals(beforeOrbit)).toBe(false);
  await page.screenshot({ path: resolve(artifactDirectory, 'garden-photo-polygon-3d.png'), fullPage: true });
  const invalid = structuredClone(stored);
  invalid.photo!.boundary = [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8 }, { x: 0.2, y: 0.8 }, { x: 0.8, y: 0.2 }];
  expect((await request.put(`${apiBase}/gardens/${id}`, { data: invalid })).status()).toBe(400);
  const wrongOrder = structuredClone(stored);
  [wrongOrder.photo!.corners[1], wrongOrder.photo!.corners[2]] = [wrongOrder.photo!.corners[2], wrongOrder.photo!.corners[1]];
  expect((await request.put(`${apiBase}/gardens/${id}`, { data: wrongOrder })).status()).toBe(400);
  expect((await gardenJson(request, id)).revision).toBe(stored.revision);
});

test('J. 未完成・交差輪郭を拒否し、戻す・始点確定・取消で保存済み輪郭を維持', async ({ page, request }) => {
  const { id, imageDataUrl } = await preparePhoto(page);
  await clickImage(page, 0.25, 0.7);
  await clickImage(page, 0.65, 0.3);
  const finish = page.getByRole('button', { name: '輪郭を確定', exact: true });
  const start = page.getByRole('button', { name: '始点につないで輪郭を確定' });
  await expect(finish).toHaveCount(0);
  await expect(page.getByTestId('save-status')).toHaveText('輪郭を描画中');
  await start.click();
  await expect(page.locator('.photo-workspace').getByRole('alert')).toContainText('3〜64点');
  await showOutline(page);
  await expect(page.locator('.photo-stage circle[fill="#ffbd68"]')).toHaveCount(2);
  await clickImage(page, 0.25, 0.3);
  await clickImage(page, 0.65, 0.7);
  await expect(finish).toHaveCount(0);
  await start.click();
  await expect(page.locator('.photo-workspace').getByRole('alert')).toContainText('線の交差');
  await expect(page.getByTestId('photo-ground')).toHaveCount(0);
  await expect(page.getByTestId('save-status')).toHaveText('輪郭を描画中');
  await page.getByRole('button', { name: '最後の点を戻す' }).click();
  await expect(page.locator('.photo-workspace').getByRole('alert')).toHaveCount(0);
  await showOutline(page);
  await expect(page.locator('.photo-stage circle[fill="#ffbd68"]')).toHaveCount(3);
  await start.click();
  await expect(page.getByTestId('photo-ground')).toBeVisible();
  await expect(page.getByTestId('save-status')).toHaveText('保存済み');
  const saved = await saveArtifact(request, id, 'garden-photo-triangle.json');
  expect(saved.photo?.boundary).toHaveLength(3);
  await page.reload();
  await showOutline(page);
  await expect(page.locator('.photo-stage circle[fill="#ffbd68"]')).toHaveCount(3);
  await showOutline(page);
  await page.getByRole('button', { name: '庭の領域を書き直す' }).click();
  for (const [x, y] of outline.slice(0, 4)) await clickImage(page, x, y);
  await expect(finish).toHaveCount(0);
  await expect(page.getByTestId('save-status')).toHaveText('輪郭を描画中');
  await expect(page.getByRole('button', { name: '3D庭', exact: true })).toBeDisabled();
  await expect(page.getByTestId('photo-ground')).toHaveCount(0);
  expect(await gardenJson(request, id)).toEqual(saved);
  await page.getByRole('button', { name: '輪郭の描画を取消' }).click();
  await expect(page.getByTestId('save-status')).toHaveText('保存済み');
  await showOutline(page);
  await expect(page.locator('.photo-stage circle[fill="#ffbd68"]')).toHaveCount(3);
  await expect(page.getByTestId('photo-ground')).toBeVisible();
  await expect(page.getByTestId('photo-preview-edge')).toHaveCount(0);
  expect(await gardenJson(request, id)).toEqual(saved);
  await showOutline(page);
  await page.getByRole('button', { name: '庭の領域を書き直す' }).click();
  for (const [x, y] of outline.slice(0, 4)) await clickImage(page, x, y);
  let unloadDialog = false;
  page.once('dialog', async (dialog) => { unloadDialog = dialog.type() === 'beforeunload'; await dialog.accept(); });
  await page.reload();
  expect(unloadDialog).toBe(true);
  await showOutline(page);
  await expect(page.locator('.photo-stage circle[fill="#ffbd68"]')).toHaveCount(3);
  await expect(page.getByTestId('save-status')).toHaveText('保存済み');
  expect(await gardenJson(request, id)).toEqual(saved);
  await page.screenshot({ path: resolve(artifactDirectory, 'garden-photo-triangle.png'), fullPage: true });
  await showOutline(page);
  await page.getByRole('button', { name: '庭の領域を書き直す' }).click();
  await clickImage(page, ...outline[0] as [number, number]);
  await page.getByLabel('庭の写真を選択').setInputFiles({ name: 'garden.png', mimeType: 'image/png', buffer: Buffer.from(imageDataUrl.split(',')[1], 'base64') });
  await expect(page.locator('.photo-stage circle[fill="#fff"]')).toHaveCount(0);
  await expect(page.locator('.photo-stage circle[fill="#ffbd68"]')).toHaveCount(0);
  await expect(finish).toHaveCount(0);
  await expect(page.locator('.photo-hint')).toContainText('0/64点');
  await clickImage(page, ...outline[0] as [number, number]);
  await expect(page.getByTestId('photo-vertex-1')).toBeVisible();
  expect(await gardenJson(request, id)).toEqual(saved);
});

for (const [name, vertices] of [
  ['quad', corners],
  ['pentagon', [[0.1, 0.85], [0.9, 0.85], [0.85, 0.4], [0.6, 0.2], [0.2, 0.2]]],
] as const) {
  test(`K. 写真直後の${vertices.length}クリックを同じ輪郭として保持し始点1で閉じる (${name})`, async ({ page, request }) => {
    const { id } = await preparePhoto(page);
    for (const [index, [x, y]] of vertices.entries()) {
      await clickImage(page, x, y);
      await expect(page.locator('.photo-stage circle[fill="#ffbd68"]')).toHaveCount(index + 1);
      await expect(page.getByTestId('save-status')).toHaveText('輪郭を描画中');
      await expect(page.getByTestId('photo-ground')).toHaveCount(0);
      await expect(page.getByTestId('save-status')).toHaveText('輪郭を描画中');
    }
    await expect(page.locator('.photo-stage circle[fill="#fff"]')).toHaveCount(0);
    await moveImage(page, 0.45, 0.5);
    await page.screenshot({ path: resolve(artifactDirectory, `garden-photo-${name}-draft.png`), fullPage: true });
    expect((await gardenJson(request, id)).photo).toBeNull();
    await page.getByTestId('photo-vertex-1').click();
    await expect(page.getByTestId('photo-ground')).toBeVisible();
    await expect(page.getByTestId('photo-preview-edge')).toHaveCount(0);
    await expect(page.locator('.photo-stage circle[fill="#ffbd68"]')).toHaveCount(vertices.length);
    await expect(page.getByTestId('save-status')).toHaveText('保存済み');
    const saved = await saveArtifact(request, id, `garden-photo-${name}.json`);
    expect(saved.photo!.boundary).toHaveLength(vertices.length);
    for (const [index, [x, y]] of vertices.entries()) {
      expect(saved.photo!.boundary[index].x).toBeCloseTo(x, 2);
      expect(saved.photo!.boundary[index].y).toBeCloseTo(y, 2);
    }
    await page.reload();
    await showOutline(page);
    await expect(page.locator('.photo-stage circle[fill="#ffbd68"]')).toHaveCount(vertices.length);
    await expect(page.getByTestId('photo-ground')).toBeVisible();
    await page.screenshot({ path: resolve(artifactDirectory, `garden-photo-${name}.png`), fullPage: true });
  });
}

test('L. 旧投影データを復元し、元の四隅を越える輪郭へ描き直して保存できる', async ({ page, request }) => {
  const { id, imageDataUrl } = await preparePhoto(page);
  const legacy = await gardenJson(request, id);
  legacy.photo = { dataUrl: imageDataUrl, imageWidth: 800, imageHeight: 600,
    corners: corners.map(([x, y]) => ({ x, y })), boundary: outline.map(([x, y]) => ({ x, y })) };
  const response = await request.put(`${apiBase}/gardens/${id}`, { data: legacy });
  expect(response.ok()).toBeTruthy();
  page.once('dialog', (dialog) => dialog.accept());
  await page.reload();
  await showOutline(page);
  await expect(page.locator('.photo-stage circle[fill="#ffbd68"]')).toHaveCount(6);
  await expect(page.getByTestId('save-status')).toHaveText('保存済み');
  expect((await gardenJson(request, id)).photo).toEqual(legacy.photo);
  await showOutline(page);
  await page.getByRole('button', { name: '庭の領域を書き直す' }).click();
  for (const [x, y] of [[0.03, 0.95], [0.97, 0.95], [0.97, 0.05], [0.03, 0.05]]) await clickImage(page, x, y);
  await page.getByTestId('photo-vertex-1').click();
  await expect(page.getByTestId('photo-ground')).toBeVisible();
  await expect(page.getByTestId('save-status')).toHaveText('保存済み');
  const saved = await saveArtifact(request, id, 'garden-photo-legacy-redraw.json');
  expect(saved.revision).toBe(2);
  expect(saved.photo!.boundary).toHaveLength(4);
  expect(saved.photo!.corners[0].x).toBeCloseTo(0.03, 2);
  await page.reload();
  await showOutline(page);
  await expect(page.locator('.photo-stage circle[fill="#ffbd68"]')).toHaveCount(4);
  await page.screenshot({ path: resolve(artifactDirectory, 'garden-photo-legacy-redraw.png'), fullPage: true });
});

test('M. 始点近くでも別の頂点のクリックでは自動確定しない', async ({ page, request }) => {
  await page.setViewportSize({ width: 1120, height: 900 });
  const { id } = await preparePhoto(page);
  for (const [x, y] of [[0.3, 0.8], [0.7, 0.8], [0.7, 0.3], [0.32125, 0.797]]) await clickImage(page, x, y);
  await showOutline(page);
  await expect(page.locator('.photo-stage circle[fill="#ffbd68"]')).toHaveCount(4);
  await expect(page.getByTestId('save-status')).toHaveText('輪郭を描画中');
  await expect(page.getByTestId('photo-ground')).toHaveCount(0);
  await page.getByTestId('photo-vertex-1').click();
  await expect(page.getByTestId('photo-ground')).toBeVisible();
  await expect(page.getByTestId('save-status')).toHaveText('保存済み');
  expect((await saveArtifact(request, id, 'garden-photo-close-vertices.json')).photo!.boundary).toHaveLength(4);
  await page.reload();
  await showOutline(page);
  await expect(page.locator('.photo-stage circle[fill="#ffbd68"]')).toHaveCount(4);
  await page.screenshot({ path: resolve(artifactDirectory, 'garden-photo-close-vertices.png'), fullPage: true });
});


test('N. 木の3D・写真相互配置、固定カメラ、頂点番号非表示、領域書き直しと保存復元', async ({ page, request }) => {
  const { id, imageDataUrl } = await preparePhoto(page);
  for (const [x, y] of outline) await clickImage(page, x, y);
  await expect(page.getByTestId('photo-vertex-number')).toHaveCount(6);
  await page.getByTestId('photo-vertex-1').click();
  await expect(page.getByTestId('photo-vertex-number')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '庭の領域を書き直す' })).toBeVisible();

  await page.getByRole('button', { name: '3D庭', exact: true }).click();
  await page.getByRole('button', { name: '上から見る' }).click();
  await selectTestPlant(page);
  const bounds = await page.locator('[data-testid="garden-canvas"] canvas').boundingBox();
  if (!bounds) throw new Error('3D庭が表示されていません。');
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await expect(page.getByTestId('object-row-0')).toBeVisible();
  const treeFrom3dId = await page.getByTestId('object-row-0').getAttribute('data-object-id');
  await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 1 / 1');
  await page.getByRole('button', { name: '写真＋設計' }).click();
  await expect(page.getByTestId('photo-model-canvas')).toHaveAttribute('data-object-count', '1');
  await expect(page.locator('[data-testid="photo-model-canvas"] canvas')).toBeVisible();
  const withTree = await page.locator('.photo-stage').screenshot();
  await page.getByLabel('配置', { exact: true }).uncheck();
  const withoutTree = await page.locator('.photo-stage').screenshot();
  expect(withTree.equals(withoutTree)).toBe(false);
  await page.getByLabel('配置', { exact: true }).check();

  await page.setViewportSize({ width: 1280, height: 900 });
  await clickImage(page, 0.3, 0.65);
  await expect(page.getByTestId('object-row-1')).toBeVisible();
  const treeFromPhotoId = await page.getByTestId('object-row-1').getAttribute('data-object-id');
  await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 2 / 2');
  await expect(page.getByTestId('photo-model-canvas')).toHaveAttribute('data-object-count', '2');
  await clickImage(page, 0.95, 0.1);
  await expect(page.getByTestId('object-row-2')).toHaveCount(0);
  await page.getByTestId('object-row-0').click();
  await clickImage(page, 0.3, 0.63);
  await expect(page.getByTestId('object-row-1')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('object-row-2')).toHaveCount(0);
  await expect(page.getByTestId('save-status')).toHaveText('保存済み');
  const beforeDragDocument = await gardenJson(request, id);
  const beforeDragOutline = await page.getByTestId('photo-ground').getAttribute('points');
  const beforeDrag = await page.locator('.photo-stage').screenshot({ path: resolve(artifactDirectory, 'photo-fixed-camera-before-drag.png') });
  const a = await screenPoint(page, 0.72, 0.72), b = await screenPoint(page, 0.6, 0.72);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  const afterDrag = await page.locator('.photo-stage').screenshot({ path: resolve(artifactDirectory, 'photo-fixed-camera-after-drag.png') });
  expect(await maximumPixelDifference(page, beforeDrag, afterDrag)).toBeLessThanOrEqual(1);
  await expect(page.getByTestId('photo-ground')).toHaveAttribute('points', beforeDragOutline!);
  await expect(page.getByTestId('save-status')).toHaveText('保存済み');
  const saved = await saveArtifact(request, id, 'garden-photo-trees.json');
  expect(saved).toEqual(beforeDragDocument);
  expect(saved.photo?.dataUrl).toBe(imageDataUrl);
  expect(saved.objects).toHaveLength(2);
  expect(saved.objects.every((object) => object.assetId === 'plant_modular' && object.productId)).toBe(true);
  // API results are ordered by object ID; identify the placed trees by identity.
  const treeFrom3d = saved.objects.find((object) => object.id === treeFrom3dId)!;
  const treeFromPhoto = saved.objects.find((object) => object.id === treeFromPhotoId)!;
  expect(treeFrom3d.position.x).toBeCloseTo(0, 1);
  expect(treeFrom3d.position.z).toBeCloseTo(0, 1);
  expect(treeFromPhoto.position.x).toBeCloseTo((0.3 - 0.15) / 0.65 * saved.width - saved.width / 2, 1);
  expect(treeFromPhoto.position.z).toBeCloseTo((0.65 - 0.25) / 0.55 * saved.depth - saved.depth / 2, 1);
  await page.reload();
  await expect(page.getByTestId('photo-vertex-number')).toHaveCount(0);
  await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 2 / 2');
  await expect(page.getByTestId('photo-model-canvas')).toHaveAttribute('data-object-count', '2');
  await page.screenshot({ path: resolve(artifactDirectory, 'garden-photo-trees.png'), fullPage: true });
  await page.getByRole('button', { name: '3D庭', exact: true }).click();
  await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 2 / 2');
  await expect(page.getByTestId('object-row-1')).toBeVisible();
  await page.screenshot({ path: resolve(artifactDirectory, 'garden-photo-trees-3d.png'), fullPage: true });
  await page.getByRole('button', { name: '写真＋設計' }).click();
  await showOutline(page);
  await page.getByRole('button', { name: '庭の領域を書き直す' }).click();
  await clickImage(page, 0.1, 0.9);
  await expect(page.getByTestId('photo-vertex-number')).toHaveCount(1);
  await expect(page.getByTestId('save-status')).toHaveText('輪郭を描画中');
  expect(await gardenJson(request, id)).toEqual(saved);
  await page.getByRole('button', { name: '輪郭の描画を取消' }).click();
  await expect(page.getByTestId('photo-vertex-number')).toHaveCount(0);
  await expect(page.getByTestId('photo-model-canvas')).toHaveAttribute('data-object-count', '2');
  await expect(page.getByTestId('save-status')).toHaveText('保存済み');
  await showOutline(page);
  await page.getByRole('button', { name: '庭の領域を書き直す' }).click();
  for (const [x, y] of [[0.1, 0.9], [0.9, 0.9], [0.9, 0.15], [0.1, 0.15]]) await clickImage(page, x, y);
  await page.getByTestId('photo-vertex-1').click();
  await expect(page.getByTestId('photo-vertex-number')).toHaveCount(0);
  await expect(page.getByTestId('save-status')).toHaveText('保存済み');
  const redrawn = await saveArtifact(request, id, 'garden-photo-trees-redrawn.json');
  expect(redrawn.photo?.boundary).toHaveLength(4);
  expect(redrawn.objects).toEqual(saved.objects);
  await page.reload();
  await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 2 / 2');
  await expect(page.getByTestId('photo-vertex-number')).toHaveCount(0);
  await page.screenshot({ path: resolve(artifactDirectory, 'garden-photo-trees-redrawn.png'), fullPage: true });
});
