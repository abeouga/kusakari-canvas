import { randomUUID } from 'node:crypto';
import { expect, type Page, type APIRequestContext } from '@playwright/test';
import { productInput } from '../scripts/plant-library-presets.mjs';
import { plantPresetsV3 } from '../scripts/plant-library-v3-presets.mjs';
import { api } from './api-url';
import type { PlantComposition } from '../frontend/src/types/garden';
type Product = { id: string; name: string; canvasMaterialCode: string; modelComposition: PlantComposition };

export async function seedLegacyObjects(page: Page, assetIds: string[]) {
  const id = new URL(page.url()).pathname.split('/').at(-1);
  const garden = await page.request.get(`${api}/gardens/${id}`).then(r => r.json());
  const objects = assetIds.map((assetId, index) => ({ id: randomUUID(), assetId,
    position: { x: (index - (assetIds.length - 1) / 2) * 1.5, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }));
  const response = await page.request.put(`${api}/gardens/${id}`, { data: { ...garden, objects } });
  expect(response.status(), await response.text()).toBe(200);
  await page.reload();
  await page.getByRole('button', { name: '上から見る', exact: true }).click();
  await page.getByTestId('object-row-0').click();
}

const selectedProducts = new WeakMap<Page, string>();

export async function createTestProduct(request: APIRequestContext, name = 'E2E配置用', imageUrl = '/images/e2e-reference.svg') {
  const origin = process.env.KUSAKARI_EC_E2E_WEB_URL;
  if (!origin) throw new Error('Use playwright.full.config.ts for real catalog placement');
  const preset = plantPresetsV3.find(item => item.key === 'soft-grass')!;
  const response = await request.post(`${origin}/api/products`, { data: {
    ...productInput(preset, imageUrl), sku: `E2E-${randomUUID()}`, name,
  } });
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}

export function productPlacement(product: Product, x = 0, z = 0, scale = 1) {
  return { id: randomUUID(), assetId: 'plant_modular', productId: product.id, productName: product.name,
    materialCode: product.canvasMaterialCode, modelComposition: product.modelComposition,
    position: { x, y: 0, z }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: scale, y: scale, z: scale } };
}

// A new real catalog product per browser page; never reactivate retired demonstration products.
export async function selectTestPlant(page: Page) {
  let id = selectedProducts.get(page);
  if (!id) {
    const origin = process.env.KUSAKARI_EC_E2E_WEB_URL;
    if (!origin) throw new Error('Use playwright.full.config.ts for real catalog placement');
    const preset = plantPresetsV3.find(item => item.key === 'soft-grass')!;
    const response = await page.request.post(`${origin}/api/products`, { data: {
      ...productInput(preset, preset.imageUrl), sku: `E2E-${randomUUID()}`,
      name: `E2E配置用-${randomUUID().slice(0, 8)}`,
    } });
    expect(response.status(), await response.text()).toBe(200);
    id = (await response.json()).id;
    selectedProducts.set(page, id!);
    await expect(page.getByTestId('save-status')).toHaveText('保存済み');
    const was3d = await page.getByRole('button', { name: '3D庭', exact: true }).getAttribute('aria-pressed') === 'true';
    await page.reload();
    await expect(page.getByTestId('save-status')).toHaveText('保存済み');
    if (was3d) await page.getByRole('button', { name: '3D庭', exact: true }).click();
    const top = page.getByRole('button', { name: '上から見る', exact: true });
    if (await top.isVisible()) await top.click();
  }
  await page.getByRole('tab', { name: '商品一覧', exact: true }).click();
  await page.getByTestId(`browse-${id}`).getByRole('button', { name: '庭に配置' }).click();
}
