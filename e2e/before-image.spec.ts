import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { PerspectiveCamera, Vector3 } from 'three';
import { api } from './api-url.js';
import type { GardenDocument } from '../frontend/src/types/garden.js';

const artifactDirectory = resolve('artifacts/e2e');
const variants = [
  { name: 'calibrated-landscape', width: 1200, height: 800, calibrated: true },
  { name: 'legacy-portrait', width: 800, height: 1200, calibrated: false },
];

async function createGarden(request: APIRequestContext) {
  const response = await request.post(`${api}/gardens`, {
    data: { name: `E2E Before ${randomUUID()}`, width: 10, depth: 8 },
  });
  expect(response.status()).toBe(201);
  return await response.json() as GardenDocument;
}

async function preparePhoto(page: Page, request: APIRequestContext, initial: GardenDocument, variant = variants[0]) {
  const camera = new PerspectiveCamera(50, variant.width / variant.height, 0.01, 1000);
  camera.position.set(5, 12, 20);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  function project(x: number, y: number, z: number) {
    const point = new Vector3(x, y, z).project(camera);
    return { x: (point.x + 1) / 2, y: (1 - point.y) / 2 };
  }
  const corners = [project(-5, 0, 4), project(5, 0, 4), project(5, 0, -4), project(-5, 0, -4)];
  // A deliberately synthetic photo keeps private garden photos out of test artifacts.
  const dataUrl = await page.evaluate(({ width, height }) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#b7d0dc';
    context.fillRect(0, 0, width, height);
    context.fillStyle = '#8eaa71';
    context.fillRect(0, height * 0.45, width, height * 0.55);
    const marks = [
      { x: 0, y: 0, color: '#c93441' },
      { x: width - 40, y: 0, color: '#254cd4' },
      { x: 0, y: height - 40, color: '#e7c619' },
      { x: width - 40, y: height - 40, color: '#a937b8' },
    ];
    for (const mark of marks) {
      context.fillStyle = mark.color;
      context.fillRect(mark.x, mark.y, 40, 40);
    }
    context.fillStyle = '#20323a';
    context.font = '20px sans-serif';
    context.fillText('SYNTHETIC / BEFORE CAPTURE TEST', 52, 32);
    return canvas.toDataURL('image/png');
  }, variant);
  const photo: NonNullable<GardenDocument['photo']> = {
    dataUrl, imageWidth: variant.width, imageHeight: variant.height, corners, boundary: corners,
  };
  if (variant.calibrated) {
    const calibration = await request.post(`${api}/photo-calibration`, {
      data: {
        imageWidth: variant.width, imageHeight: variant.height, points: corners,
        referenceWidth: 10, referenceDepth: 8,
        focalLengthPx: variant.height / (2 * Math.tan(50 * Math.PI / 360)),
      },
    });
    expect(calibration.status()).toBe(200);
    photo.calibration = await calibration.json();
  }
  const objects = [
    { id: randomUUID(), assetId: 'tree_oak', position: { x: -3, y: 0, z: 2.5 },
      rotation: { x: 0, y: 0, z: 0 }, scale: { x: 0.7, y: 0.7, z: 0.7 } },
    { id: randomUUID(), assetId: 'shrub_boxwood', position: { x: 3, y: 0, z: -2.5 },
      rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1.2, y: 1.2, z: 1.2 } },
  ];
  const saved = await request.put(`${api}/gardens/${initial.id}`, { data: { ...initial, photo, objects } });
  expect(saved.status()).toBe(200);
  // GET is the canonical snapshot used by the editor (objects are ordered by ID).
  const stored = await request.get(`${api}/gardens/${initial.id}`);
  expect(stored.status()).toBe(200);
  const garden = await stored.json() as GardenDocument;
  await page.goto(`/gardens/${initial.id}`);
  await expect(page.getByTestId('photo-model-canvas')).toBeVisible();
  return { garden, bases: objects.map((object) => project(object.position.x, 0, object.position.z)) };
}

async function captureImage(page: Page) {
  if (!await page.getByRole('button', { name: '完成イメージを確認', exact: true }).isVisible()) await page.getByRole('button', { name: /^(AI生成|完成イメージ)メニュー$/ }).click();

  await page.getByRole('button', { name: '完成イメージを確認', exact: true }).click();
  const image = page.getByAltText('現在の庭の完成イメージ');
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((node) => (node as HTMLImageElement).complete)).toBe(true);
  const source = await image.getAttribute('src');
  expect(source).toMatch(/^data:image\/png;base64,/);
  await page.keyboard.press('Escape');
  return source!;
}

async function comparePixels(page: Page, first: string, second: string, photoSource?: string) {
  return page.evaluate(async ({ first, second, photoSource }) => {
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
    const left = await decode(first);
    const right = await decode(second);
    const sameDimensions = left.width === right.width && left.height === right.height;
    if (!sameDimensions) throw new Error('比較画像の寸法が一致しません。');
    let photo = null;
    if (photoSource) photo = await decode(photoSource);
    let differences = 0;
    let alphaDifferences = 0;
    let coverageDifferences = 0;
    let plantSquaredError = 0;
    let plantPixelCount = 0;
    for (let index = 0; index < left.pixels.length; index += 4) {
      let leftHasPlant = false;
      let rightHasPlant = false;
      let squaredError = 0;
      for (let channel = 0; channel < 4; channel++) {
        const leftValue = left.pixels[index + channel];
        const rightValue = right.pixels[index + channel];
        if (leftValue !== rightValue) differences++;
        if (channel === 3 && leftValue !== rightValue) alphaDifferences++;
        if (channel < 3) squaredError += (leftValue - rightValue) ** 2;
        if (photo) {
          const photoValue = photo.pixels[index + channel];
          if (leftValue !== photoValue) leftHasPlant = true;
          if (rightValue !== photoValue) rightHasPlant = true;
        }
      }
      if (leftHasPlant !== rightHasPlant) coverageDifferences++;
      if (leftHasPlant || rightHasPlant) {
        plantSquaredError += squaredError;
        plantPixelCount++;
      }
    }
    let plantRgbRmse = 0;
    if (plantPixelCount > 0) plantRgbRmse = Math.sqrt(plantSquaredError / (plantPixelCount * 3));
    return { differences, alphaDifferences, coverageDifferences, plantRgbRmse };
  }, { first, second, photoSource });
}

async function canvasDimensions(page: Page) {
  return page.locator('.photo-models canvas').evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    return { width: canvas.width, height: canvas.height, style: canvas.getAttribute('style') };
  });
}

for (const variant of variants) {
  test(`Before image preserves photo framing, every plant and editor state: ${variant.name}`, async ({ page, request }) => {
    const initial = await createGarden(request);
    try {
      const { garden, bases } = await preparePhoto(page, request, initial, variant);
      await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 2 / 2');
      const dimensions = await canvasDimensions(page);
      const baseline = await captureImage(page);
      const photo = garden.photo!;
      const measurements = await page.evaluate(async ({ source, result, bases }) => {
        async function pixels(url: string) {
          const image = new Image();
          image.src = url;
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          const context = canvas.getContext('2d')!;
          context.drawImage(image, 0, 0);
          return { width: canvas.width, height: canvas.height,
            data: context.getImageData(0, 0, canvas.width, canvas.height).data };
        }
        const before = await pixels(source);
        const after = await pixels(result);
        let changed = 0;
        let transparent = 0;
        const nearBases = bases.map(() => 0);
        for (let y = 0; y < after.height; y++) {
          for (let x = 0; x < after.width; x++) {
            const offset = (y * after.width + x) * 4;
            if (after.data[offset + 3] !== 255) transparent++;
            let different = false;
            for (let channel = 0; channel < 3; channel++) {
              if (before.data[offset + channel] !== after.data[offset + channel]) different = true;
            }
            if (!different) continue;
            changed++;
            for (let index = 0; index < bases.length; index++) {
              const base = bases[index];
              if (Math.abs(x - base.x * after.width) < 20 && Math.abs(y - base.y * after.height) < 20) {
                nearBases[index]++;
              }
            }
          }
        }
        const corners = [[10, 10], [after.width - 10, 10], [10, after.height - 10], [after.width - 10, after.height - 10]];
        const cornersMatch = corners.every(([x, y]) => {
          const offset = (y * after.width + x) * 4;
          for (let channel = 0; channel < 4; channel++) {
            if (before.data[offset + channel] !== after.data[offset + channel]) return false;
          }
          return true;
        });
        return { width: after.width, height: after.height, changed, transparent, nearBases, cornersMatch };
      }, { source: photo.dataUrl, result: baseline, bases });
      expect(measurements.width).toBe(photo.imageWidth);
      expect(measurements.height).toBe(photo.imageHeight);
      expect(measurements.changed).toBeGreaterThan(500);
      expect(measurements.transparent).toBe(0);
      expect(measurements.cornersMatch).toBe(true);
      for (const changed of measurements.nearBases) expect(changed).toBeGreaterThan(5);

      await page.getByTestId('object-row-0').click();
      const selected = await captureImage(page);
      expect((await comparePixels(page, baseline, selected)).differences).toBe(0);
      await expect(page.getByTestId('object-row-0')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('save-status')).toHaveText('保存済み');
      expect(await canvasDimensions(page)).toEqual(dimensions);

      await page.getByRole('checkbox', { name: '配置', exact: true }).uncheck();
      await page.getByRole('checkbox', { name: 'グリッド', exact: true }).uncheck();
      await page.getByRole('checkbox', { name: '地面', exact: true }).uncheck();
      await expect(page.getByTestId('photo-model-canvas')).toHaveAttribute('data-object-count', '0');
      // Locator screenshots include overlapping HTML. Keep keyboard focus identical
      // so the restored launcher's focus ring is not mistaken for changed WebGL pixels.
      await page.getByRole('checkbox', { name: '地面', exact: true }).focus();
      const hiddenViewBefore = await page.locator('.photo-models canvas').screenshot();
      const hidden = await captureImage(page);
      expect((await comparePixels(page, baseline, hidden)).differences).toBe(0);
      await expect(page.getByRole('checkbox', { name: '配置', exact: true })).not.toBeChecked();
      await expect(page.getByTestId('photo-model-canvas')).toHaveAttribute('data-object-count', '0');
      await page.getByRole('checkbox', { name: '地面', exact: true }).focus();
      const hiddenViewAfter = await page.locator('.photo-models canvas').screenshot();
      await mkdir(artifactDirectory, { recursive: true });
      await writeFile(resolve(artifactDirectory, `hidden-${variant.name}-before.png`), hiddenViewBefore);
      await writeFile(resolve(artifactDirectory, `hidden-${variant.name}-after.png`), hiddenViewAfter);
      expect((await comparePixels(page,
        `data:image/png;base64,${hiddenViewBefore.toString('base64')}`,
        `data:image/png;base64,${hiddenViewAfter.toString('base64')}`)).differences).toBe(0);

      if (variant.calibrated) {
        // Explicit capture-copy fault verifies finally restores visibility and renderer dimensions.
        await page.evaluate(() => {
          const drawImage = CanvasRenderingContext2D.prototype.drawImage;
          CanvasRenderingContext2D.prototype.drawImage = function (source: CanvasImageSource, ...values: number[]) {
            if (source instanceof HTMLCanvasElement && source.matches('.photo-models canvas')) {
              CanvasRenderingContext2D.prototype.drawImage = drawImage;
              throw new Error('E2E capture copy failure');
            }
            return Reflect.apply(drawImage, this, [source, ...values]);
          };
        });
        if (!await page.getByRole('button', { name: '完成イメージを確認', exact: true }).isVisible()) await page.getByRole('button', { name: /^(AI生成|完成イメージ)メニュー$/ }).click();
    await page.getByRole('button', { name: '完成イメージを確認', exact: true }).click();
        await expect(page.getByTestId('completion-launcher').getByRole('alert')).toContainText('E2E capture copy failure');
        expect(await canvasDimensions(page)).toEqual(dimensions);
        await expect(page.getByTestId('object-row-0')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByRole('checkbox', { name: '配置', exact: true })).not.toBeChecked();
        const retry = await captureImage(page);
        expect((await comparePixels(page, baseline, retry)).differences).toBe(0);
      }

      await page.setViewportSize({ width: 390, height: 960 });
      const mobile = await captureImage(page);
      expect((await comparePixels(page, baseline, mobile)).differences).toBe(0);
      expect(await (await request.get(`${api}/gardens/${initial.id}`)).json()).toEqual(garden);
      await page.setViewportSize({ width: 1440, height: 960 });
      await page.reload();
      await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 2 / 2');
      const reloaded = await captureImage(page);
      const reloadComparison = await comparePixels(page, baseline, reloaded, photo.dataUrl);
      expect(reloadComparison.coverageDifferences).toBe(0);
      expect(reloadComparison.alphaDifferences).toBe(0);
      // A fresh WebGL context must preserve the footprint and colour fidelity.
      // Bound RGB RMS error over plant pixels to half of one 8-bit colour step.
      expect(reloadComparison.plantRgbRmse).toBeLessThanOrEqual(0.5);
      expect(await (await request.get(`${api}/gardens/${initial.id}`)).json()).toEqual(garden);
      await mkdir(artifactDirectory, { recursive: true });
      await writeFile(resolve(artifactDirectory, `before-${variant.name}.json`), JSON.stringify(garden, null, 2));
      await writeFile(resolve(artifactDirectory, `before-${variant.name}-metrics.json`), JSON.stringify({ ...measurements, reloadComparison }, null, 2));
      if (!await page.getByRole('button', { name: '完成イメージを確認', exact: true }).isVisible()) await page.getByRole('button', { name: /^(AI生成|完成イメージ)メニュー$/ }).click();
    await page.getByRole('button', { name: '完成イメージを確認', exact: true }).click();
      await expect(page.getByAltText('現在の庭の完成イメージ')).toBeVisible();
      await expect(page.getByRole('dialog', { name: '庭の完成イメージ' })).toContainText('Before画像');
      const downloadEvent = page.waitForEvent('download');
      await page.getByTestId('generation-details').locator('summary').click();
      await page.getByRole('link', { name: 'Before画像をPNGで保存', exact: true }).click();
      const download = await downloadEvent;
      expect(download.suggestedFilename()).toBe('kusakari-before.png');
      await download.saveAs(resolve(artifactDirectory, `before-${variant.name}.png`));
      await page.screenshot({ path: resolve(artifactDirectory, `before-${variant.name}-reloaded.png`), fullPage: true });
    } finally {
      expect((await request.delete(`${api}/gardens/${initial.id}`)).status()).toBe(204);
    }
  });
}

test('loading and failed real models block capture and retry produces a complete Before', async ({ page, request }) => {
  const initial = await createGarden(request);
  let releaseModelRequest = () => {};
  const modelRequest = new Promise<void>((resolveRequest) => { releaseModelRequest = resolveRequest; });
  try {
    // Deliberate GLB delay and failure; garden/photo APIs and MySQL remain real.
    await page.route('**/models/tree-oak.glb', async (route) => {
      await modelRequest;
      await route.abort('failed');
    });
    await preparePhoto(page, request, initial);
    await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 1 / 2');
    await page.getByRole('checkbox', { name: '配置', exact: true }).uncheck();
    if (!await page.getByRole('button', { name: '完成イメージを確認', exact: true }).isVisible()) await page.getByRole('button', { name: /^(AI生成|完成イメージ)メニュー$/ }).click();
    await page.getByRole('button', { name: '完成イメージを確認', exact: true }).click();
    await expect(page.getByTestId('completion-launcher').getByRole('alert')).toContainText('モデルを読み込み中');
    releaseModelRequest();
    await expect(page.getByRole('button', { name: 'モデルを再試行', exact: true })).toBeVisible();
    if (!await page.getByRole('button', { name: '完成イメージを確認', exact: true }).isVisible()) await page.getByRole('button', { name: /^(AI生成|完成イメージ)メニュー$/ }).click();
    await page.getByRole('button', { name: '完成イメージを確認', exact: true }).click();
    await expect(page.getByTestId('completion-launcher').getByRole('alert')).toContainText('読み込めないモデル');
    await expect(page.getByRole('dialog', { name: '庭の完成イメージ' })).toHaveCount(0);
    await page.unroute('**/models/tree-oak.glb');
    await page.getByRole('button', { name: 'モデルを再試行', exact: true }).click();
    await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 2 / 2');
    await captureImage(page);
    await expect(page.getByRole('checkbox', { name: '配置', exact: true })).not.toBeChecked();
  } finally {
    releaseModelRequest();
    expect((await request.delete(`${api}/gardens/${initial.id}`)).status()).toBe(204);
  }
});

test('3D preview excludes move, rotate and scale controls without clearing selection', async ({ page, request }) => {
  const initial = await createGarden(request);
  try {
    await preparePhoto(page, request, initial);
    await page.getByRole('button', { name: '3D庭', exact: true }).click();
    await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 2 / 2');
    const baseline = await captureImage(page);
    await page.getByTestId('object-row-0').click();
    for (const tool of ['move', 'rotate', 'scale']) {
      await page.getByTestId(`tool-${tool}`).click();
      const selected = await captureImage(page);
      expect((await comparePixels(page, baseline, selected)).differences).toBe(0);
      await expect(page.getByTestId('object-row-0')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId(`tool-${tool}`)).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('save-status')).toHaveText('保存済み');
    }
  } finally {
    expect((await request.delete(`${api}/gardens/${initial.id}`)).status()).toBe(204);
  }
});
