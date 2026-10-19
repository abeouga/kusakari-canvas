import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { expect, type Page } from '@playwright/test';
import type { GardenDocument, GardenObject, GardenPhoto } from '../frontend/src/types/garden.js';
import { shrub, type Capture } from './occlusion-helpers.js';

export type QualityCase = 'single' | 'multiple' | 'overlap';
export type QualityPayload = {
  generationId: string;
  document: GardenDocument;
  beforeDataUrl: string;
  coverageDataUrl: string;
  layout: unknown[];
  storeId: number;
  references: { assetId: string; productId: string; photoDataUrl: string }[];
};
export const fixtureDirectory = resolve('e2e/fixtures/ai-quality');
export const placementAssumption = '写真の庭下半分へ評価用10m×8m平面を仮置きした配置です。現地実寸とカメラ校正は未測定です。';

export function qualityObjects(name: QualityCase): GardenObject[] {
  if (name === 'single') return [shrub(0, 0, 1.2)];
  if (name === 'multiple') {
    return [{ ...shrub(-2, 0, 0.65), assetId: 'tree_oak' }, shrub(0.7, 1.4), shrub(2.6, -0.8)];
  }
  return [
    { ...shrub(-1.5, 0.7, 0.8), assetId: 'tree_oak' }, shrub(-1.2, -1.8),
    { ...shrub(1.2, 1, 3), assetId: 'bench_wood' }, shrub(2.3, -0.3),
    shrub(1, -2, 0.45),
  ];
}

export async function qualityPhoto(page: Page): Promise<GardenPhoto> {
  const bytes = await readFile(resolve(fixtureDirectory, 'garden.jpg'));
  const dataUrl = `data:image/jpeg;base64,${bytes.toString('base64')}`;
  const dimensions = await page.evaluate(async (source) => {
    const image = new Image();
    image.src = source;
    await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight };
  }, dataUrl);
  const corners = [{ x: 0.08, y: 0.97 }, { x: 0.92, y: 0.97 }, { x: 0.7, y: 0.6 }, { x: 0.3, y: 0.6 }];
  return { dataUrl, imageWidth: dimensions.width, imageHeight: dimensions.height,
    corners, boundary: corners, projectionSize: { width: 10, depth: 8 } };
}

export function imageBytes(source: string) {
  return Buffer.from(source.split(',')[1], 'base64');
}

export async function saveJson(directory: string, filename: string, value: unknown) {
  await writeFile(resolve(directory, filename), JSON.stringify(value, null, 2) + '\n');
}

export async function saveCapture(directory: string, garden: GardenDocument, captured: Capture) {
  await mkdir(directory, { recursive: true });
  await copyFile(resolve(fixtureDirectory, 'garden.jpg'), resolve(directory, 'photo.jpg'));
  await copyFile(resolve(fixtureDirectory, 'boxwood.jpg'), resolve(directory, 'fixture-boxwood.jpg'));
  await copyFile(resolve(fixtureDirectory, 'oak.jpg'), resolve(directory, 'fixture-oak.jpg'));
  await copyFile(resolve(fixtureDirectory, 'README.md'), resolve(directory, 'README.md'));
  await copyFile(resolve(fixtureDirectory, 'sources.json'), resolve(directory, 'sources.json'));
  await writeFile(resolve(directory, 'before.png'), imageBytes(captured.before));
  await saveJson(directory, 'snapshot.json', garden);
}

export async function uploadReferences(page: Page, garden: GardenDocument) {
  const references = [
    { assetId: 'tree_oak', name: '木', product: 'canvas-oak', filename: 'oak.jpg' },
    { assetId: 'shrub_boxwood', name: '低木', product: 'canvas-boxwood', filename: 'boxwood.jpg' },
  ];
  for (const reference of references) {
    if (!garden.objects.some((object) => object.assetId === reference.assetId)) continue;
    const selection = page.getByRole('combobox', { name: `${reference.name}に対応する商品`, exact: true });
    await expect(selection.locator(`option[value="${reference.product}"]`)).toBeAttached();
    await selection.selectOption(reference.product);
    await page.getByLabel(`${reference.name}の参考写真を追加・選び直す`, { exact: true }).setInputFiles(resolve(fixtureDirectory, reference.filename));
    await expect(page.getByAltText(`${reference.name}の選択した参考写真`, { exact: true })).toBeVisible();
  }
}

export async function saveRequest(directory: string, payload: QualityPayload) {
  await writeFile(resolve(directory, 'coverage.png'), imageBytes(payload.coverageDataUrl));
  const inputOrder: { index: number; kind: string; file: string; assetId?: string; placementId?: string; productId?: string }[] = [
    { index: 1, kind: 'before', file: 'before.png' },
  ];
  for (const item of payload.references) {
    let extension = 'jpg';
    if (item.photoDataUrl.startsWith('data:image/png;')) extension = 'png';
    else if (item.photoDataUrl.startsWith('data:image/webp;')) extension = 'webp';
    else if (!item.photoDataUrl.startsWith('data:image/jpeg;')) throw new Error('参照画像のMIME形式を判定できません。');
    let plantName = 'boxwood';
    if (item.assetId === 'tree_oak') plantName = 'oak';
    const file = `reference-${plantName}.${extension}`;
    await writeFile(resolve(directory, file), imageBytes(item.photoDataUrl));
    inputOrder.push({ index: inputOrder.length + 1, kind: 'uploaded-reference', file,
      assetId: item.assetId, productId: item.productId });
  }
  await saveJson(directory, 'request.json', { submitted: true, generationId: payload.generationId,
    layout: payload.layout,
    gardenSnapshot: 'snapshot.json', storeId: payload.storeId, coverage: 'coverage.png',
    coverageIsProviderReference: false, inputOrder, placementAssumption,
    providerPadding: 'Before画像は生成寸法へ変換。参照写真は別途不透明化。',
  });
  return inputOrder;
}

export async function downloadImage(page: Page, directory: string, label: string, filename: string, source: string) {
  const pending = page.waitForEvent('download');
  await page.getByRole('link', { name: label, exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe(filename);
  const path = resolve(directory, `download-${filename}`);
  await download.saveAs(path);
  const bytes = await readFile(path);
  expect(bytes.equals(imageBytes(source))).toBe(true);
  return { filename, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}

export async function measureOutput(page: Page, before: string, after: string, coverage: string) {
  return page.evaluate(async ({ before, after, coverage }) => {
    async function decode(source: string, size?: { width: number; height: number }) {
      const image = new Image();
      image.src = source;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = size?.width ?? image.naturalWidth;
      canvas.height = size?.height ?? image.naturalHeight;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const result = { width: canvas.width, height: canvas.height,
        pixels: context.getImageData(0, 0, canvas.width, canvas.height).data };
      image.src = '';
      canvas.width = 0;
      canvas.height = 0;
      return result;
    }
    const original = await decode(before);
    // Normalize only the diagnostic sample. Stored/downloaded output remains byte-exact.
    const result = await decode(after, original);
    const signal = await decode(coverage);
    if (original.width !== result.width || original.height !== result.height || signal.width !== original.width || signal.height !== original.height) {
      throw new Error('Before／After／coverageの寸法が一致しません。');
    }
    let changed = 0;
    let protectedChanges = 0;
    let furnitureChanges = 0;
    let transparent = 0;
    let coverageTransparent = 0;
    let plantPixels = 0;
    let furniturePixels = 0;
    for (let y = 0; y < original.height; y++) {
      for (let x = 0; x < original.width; x++) {
        const index = (y * original.width + x) * 4;
        if (result.pixels[index + 3] !== 255) transparent++;
        if (signal.pixels[index + 3] !== 255) coverageTransparent++;
        if (signal.pixels[index] > 2) plantPixels++;
        if (signal.pixels[index + 1] > 2) furniturePixels++;
        let different = false;
        for (let channel = 0; channel < 4; channel++) {
          if (original.pixels[index + channel] !== result.pixels[index + channel]) different = true;
        }
        if (!different) continue;
        changed++;
        if (signal.pixels[index + 1] > 2) furnitureChanges++;
        let nearPlant = false;
        for (let row = Math.max(0, y - 8); row <= Math.min(original.height - 1, y + 8); row++) {
          for (let column = Math.max(0, x - 8); column <= Math.min(original.width - 1, x + 8); column++) {
            if (signal.pixels[(row * original.width + column) * 4] > 2) { nearPlant = true; break; }
          }
          if (nearPlant) break;
        }
        if (!nearPlant) protectedChanges++;
      }
    }
    return { width: result.width, height: result.height, changed, protectedChanges,
      furnitureChanges, transparent, coverageTransparent, plantPixels, furniturePixels };
  }, { before, after, coverage });
}
