import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import type { GardenDocument, GardenObject, GardenPhoto } from '../frontend/src/types/garden.js';
import { api } from './api-url.js';

export const artifacts = resolve('artifacts/e2e');
export type Capture = { before: string };

export function shrub(x: number, z: number, scale = 1): GardenObject {
  return { id: randomUUID(), assetId: 'shrub_boxwood', position: { x, y: 0, z },
    rotation: { x: 0, y: 0, z: 0 }, scale: { x: scale, y: scale, z: scale } };
}

export async function syntheticPhoto(page: Page, width = 1200, height = 800): Promise<GardenPhoto> {
  const dataUrl = await page.evaluate(({ width, height }) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#b7d0dc';
    context.fillRect(0, 0, width, height);
    context.fillStyle = '#8eaa71';
    context.fillRect(0, height * 0.45, width, height * 0.55);
    for (const [x, y, color] of [[0, 0, '#c93441'], [width - 40, 0, '#254cd4'],
      [0, height - 40, '#e7c619'], [width - 40, height - 40, '#a937b8']] as const) {
      context.fillStyle = color;
      context.fillRect(x, y, 40, 40);
    }
    return canvas.toDataURL('image/png');
  }, { width, height });
  const corners = [{ x: 0.1, y: 0.9 }, { x: 0.9, y: 0.9 }, { x: 0.9, y: 0.1 }, { x: 0.1, y: 0.1 }];
  // A smaller established projection frame permits valid garden placements outside the photo.
  return { dataUrl, imageWidth: width, imageHeight: height, corners, boundary: corners,
    projectionSize: { width: 10, depth: 8 } };
}

export async function createScene(request: APIRequestContext, ids: string[], photo: GardenPhoto, objects: GardenObject[]) {
  const created = await request.post(`${api}/gardens`, {
    data: { name: `E2E AI image ${randomUUID()}`, width: 20, depth: 16 },
  });
  expect(created.status()).toBe(201);
  const initial = await created.json() as GardenDocument;
  ids.push(initial.id);
  const saved = await request.put(`${api}/gardens/${initial.id}`, { data: { ...initial, photo, objects } });
  expect(saved.status(), await saved.text()).toBe(200);
  return await readGarden(request, initial.id);
}

export async function readGarden(request: APIRequestContext, id: string) {
  const response = await request.get(`${api}/gardens/${id}`);
  expect(response.status()).toBe(200);
  return await response.json() as GardenDocument;
}

export async function openScene(page: Page, garden: GardenDocument) {
  await page.goto(`/gardens/${garden.id}`);
  await expect(page.getByTestId('photo-model-canvas')).toBeVisible();
  await expect(page.getByTestId('model-loaded')).toHaveText(`読み込み済み: ${garden.objects.length} / ${garden.objects.length}`);
}

export async function capture(page: Page): Promise<Capture> {
  await page.getByRole('button', { name: /^(AI生成|完成イメージ)メニュー$/ }).click();
  await page.getByRole('button', { name: '完成イメージを確認', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '庭の完成イメージ' })).toBeVisible();
  const before = page.getByTestId('before-image');
  await expect(before).toBeVisible();
  const source = await before.getAttribute('src');
  expect(source).toMatch(/^data:image\/png;base64,/);
  return { before: source! };
}

export async function compare(page: Page, first: string, second: string, photo: string) {
  return page.evaluate(async ({ first, second, photo }) => {
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
    const background = await decode(photo);
    if (left.width !== right.width || left.height !== right.height || left.width !== background.width || left.height !== background.height) {
      throw new Error('比較画像の寸法が一致しません。');
    }
    let differences = 0;
    let coverageDifferences = 0;
    let alphaDifferences = 0;
    let squaredError = 0;
    let plantPixels = 0;
    let leftPlantPixels = 0;
    let backgroundPixels = 0;
    for (let index = 0; index < left.pixels.length; index += 4) {
      let leftPlant = false;
      let rightPlant = false;
      let error = 0;
      for (let channel = 0; channel < 4; channel++) {
        const a = left.pixels[index + channel];
        const b = right.pixels[index + channel];
        if (a !== b) differences++;
        if (channel === 3 && a !== b) alphaDifferences++;
        if (channel < 3) error += (a - b) ** 2;
        if (a !== background.pixels[index + channel]) leftPlant = true;
        if (b !== background.pixels[index + channel]) rightPlant = true;
      }
      if (leftPlant !== rightPlant) coverageDifferences++;
      if (leftPlant || rightPlant) { squaredError += error; plantPixels++; }
      if (leftPlant) leftPlantPixels++;
      else backgroundPixels++;
    }
    let plantRgbRmse = 0;
    if (plantPixels > 0) plantRgbRmse = Math.sqrt(squaredError / (plantPixels * 3));
    const cornersMatch = [[10, 10], [left.width - 10, 10], [10, left.height - 10],
      [left.width - 10, left.height - 10]].every(([x, y]) => {
      const offset = (y * left.width + x) * 4;
      return [0, 1, 2, 3].every((channel) => left.pixels[offset + channel] === background.pixels[offset + channel]);
    });
    return { width: left.width, height: left.height, differences, coverageDifferences,
      alphaDifferences, plantRgbRmse, leftPlantPixels, backgroundPixels, cornersMatch };
  }, { first, second, photo });
}

export function expectSameImage(measurements: Awaited<ReturnType<typeof compare>>, sameContext = false) {
  expect(measurements.coverageDifferences).toBe(0);
  expect(measurements.alphaDifferences).toBe(0);
  expect(measurements.plantRgbRmse).toBeLessThanOrEqual(0.5);
  if (sameContext) expect(measurements.differences).toBe(0);
}

export async function measureContributions(page: Page, combined: string, target: string, occluder: string, photo: string) {
  return page.evaluate(async ({ combined, target, occluder, photo }) => {
    async function decode(source: string) {
      const image = new Image();
      image.src = source;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, canvas.width, canvas.height).data;
    }
    const all = await decode(combined);
    const alone = await decode(target);
    const front = await decode(occluder);
    const background = await decode(photo);
    let visibleThroughBackground = 0;
    let blockedByOccluder = 0;
    for (let index = 0; index < all.length; index += 4) {
      let targetSignal = false;
      let frontSignal = false;
      let matchesTarget = true;
      let matchesFront = true;
      for (let channel = 0; channel < 3; channel++) {
        if (Math.abs(alone[index + channel] - background[index + channel]) > 10) targetSignal = true;
        if (Math.abs(front[index + channel] - background[index + channel]) > 10) frontSignal = true;
        if (Math.abs(all[index + channel] - alone[index + channel]) > 1) matchesTarget = false;
        if (Math.abs(all[index + channel] - front[index + channel]) > 1) matchesFront = false;
      }
      if (!targetSignal) continue;
      if (!frontSignal && matchesTarget) visibleThroughBackground++;
      if (frontSignal && matchesFront) blockedByOccluder++;
    }
    return { visibleThroughBackground, blockedByOccluder };
  }, { combined, target, occluder, photo });
}

export async function saveEvidence(page: Page, garden: GardenDocument, result: Capture, name: string, metrics: unknown = {}) {
  await mkdir(artifacts, { recursive: true });
  await writeFile(resolve(artifacts, `${name}.json`), JSON.stringify(garden, null, 2));
  await writeFile(resolve(artifacts, `${name}-metrics.json`), JSON.stringify({ metrics }, null, 2));
  await writeFile(resolve(artifacts, `${name}-before.png`), Buffer.from(result.before.split(',')[1], 'base64'));
  await page.screenshot({ path: resolve(artifacts, `${name}-reloaded.png`), fullPage: true });
}

export async function removeScenes(request: APIRequestContext, ids: string[]) {
  for (const id of ids) expect((await request.delete(`${api}/gardens/${id}`)).status()).toBe(204);
}

export async function dimensions(page: Page) {
  return page.locator('.photo-models canvas').evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    return { width: canvas.width, height: canvas.height, style: canvas.getAttribute('style') };
  });
}
