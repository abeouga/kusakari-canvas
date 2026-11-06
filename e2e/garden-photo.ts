import { expect, type Page } from './test.js';
import { api } from './api-url.js';
import { readGarden, syntheticPhoto } from './occlusion-helpers.js';
import type { GardenDocument } from '../frontend/src/types/garden.js';

/**
 * 庭写真が未アップロードの庭には配置できない（#15）。配置そのものを検証するテストの前提として、
 * 庭全体を輪郭とする確定済みの写真を実APIで保存します。3D庭の配置可能範囲は写真なしの土台と同じです。
 * 写真のアップロード操作自体は photo-required-placement.spec.ts などで検証します。編集画面を開く前に呼ぶか、呼んだ後に再読み込みしてください。
 */
export async function seedGardenPhoto(page: Page, gardenId: string): Promise<GardenDocument> {
  const request = page.request;
  const photo = await syntheticPhoto(page, 600, 400);
  delete photo.projectionSize;
  const garden = await readGarden(request, gardenId);
  const saved = await request.put(`${api}/gardens/${gardenId}`, { data: { ...garden, photo } });
  expect(saved.status(), await saved.text()).toBe(200);
  return await saved.json() as GardenDocument;
}
