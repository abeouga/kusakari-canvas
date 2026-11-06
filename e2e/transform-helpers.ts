import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { PerspectiveCamera, Vector3 } from 'three';
import type { GardenDocument } from '../frontend/src/types/garden';
import { readGarden } from './occlusion-helpers';
import { showProductsTab } from './catalog-fixture';

// Switches the 3D view to "上から見る" and lets the camera settle before pointer work.
export async function showTopView(page: Page) {
  await page.getByRole('button', { name: '上から見る', exact: true }).click();
  await page.waitForTimeout(400);
}

// Screen point of a garden point while the 3D view shows "上から見る".
export async function topViewPoint(page: Page, garden: GardenDocument, x: number, z: number, y = 0) {
  const bounds = (await page.locator('[data-testid="garden-canvas"] canvas').boundingBox())!;
  const camera = new PerspectiveCamera(42, bounds.width / bounds.height, 0.1, 300);
  camera.up.set(0, 0, -1);
  camera.position.set(0, Math.max(garden.width, garden.depth) * 1.8, 0.001);
  camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
  const p = new Vector3(x, y, z).project(camera);
  return { x: bounds.x + (p.x + 1) * bounds.width / 2, y: bounds.y + (1 - p.y) * bounds.height / 2 };
}

// Drags the selected object with the move tool by a ground offset (metres) in the top view,
// the way a user moves it. `garden` is the document shown on screen.
export async function dragSelectedObject(page: Page, garden: GardenDocument, dx: number, dz: number) {
  await showProductsTab(page);
  const row = page.locator('[data-testid^="object-row-"][aria-pressed="true"]');
  const selected = await row.getAttribute('data-object-id');
  // An unsaved object is located by the position the placed-objects list shows.
  const position = garden.objects.find((item) => item.id === selected)?.position
    ?? parseLabel(await row.locator('small').textContent());
  const from = await topViewPoint(page, garden, position.x, position.z);
  const to = await topViewPoint(page, garden, position.x + dx, position.z + dz);
  await page.mouse.move(from.x + 5, from.y); await page.mouse.down();
  await page.mouse.move(to.x + 5, to.y, { steps: 8 }); await page.mouse.up();
}

// Moves the selected object and returns the garden once the move has been saved.
export async function moveSelectedObject(page: Page, request: APIRequestContext, gardenId: string, dx: number, dz: number) {
  const before = await readGarden(request, gardenId);
  await dragSelectedObject(page, before, dx, dz);
  await expect.poll(async () => (await readGarden(request, gardenId)).revision).toBeGreaterThan(before.revision);
  return readGarden(request, gardenId);
}

// The position as the placed-objects list shows it to the user.
export function positionLabel(position: { x: number; z: number }) {
  return `X ${position.x.toFixed(1)} · Z ${position.z.toFixed(1)}`;
}

function parseLabel(label: string | null) {
  const match = label?.match(/^X (-?[\d.]+) · Z (-?[\d.]+)$/);
  if (!match) throw new Error('移動する配置物が選択されていません。');
  return { x: Number(match[1]), z: Number(match[2]) };
}
