import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { PerspectiveCamera, Vector3 } from 'three';
import { api } from './api-url';
import { readGarden } from './occlusion-helpers';
import type { GardenDocument } from '../frontend/src/types/garden';

async function screen(page: Page, garden: GardenDocument, x: number, y: number, z: number) {
  const bounds = (await page.locator('[data-testid="garden-canvas"] canvas').boundingBox())!;
  const camera = new PerspectiveCamera(42, bounds.width / bounds.height, 0.1, 300);
  camera.up.set(0, 0, -1);
  camera.position.set(0, Math.max(garden.width, garden.depth) * 1.8, 0.001);
  camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
  const p = new Vector3(x, y, z).project(camera);
  return { x: bounds.x + (p.x + 1) * bounds.width / 2, y: bounds.y + (1 - p.y) * bounds.height / 2 };
}

test('3d body movement, rotation ring and scale handle survive saving and reload', async ({ page, request }) => {
  const created = await request.post(`${api}/gardens`, { data: { name: `E2E transforms ${randomUUID()}`, width: 10, depth: 8 } });
  expect(created.ok()).toBeTruthy();
  let garden = await created.json() as GardenDocument;
  const stored = await request.put(`${api}/gardens/${garden.id}`, { data: { ...garden, objects: [{
    id: randomUUID(), assetId: 'bench_wood', position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
  }] } });
  expect(stored.ok()).toBeTruthy(); garden = await stored.json();
  await page.goto(`/gardens/${garden.id}`);
  await page.getByRole('button', { name: '3D庭', exact: true }).click();
  await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 1 / 1');
  await page.getByRole('button', { name: '上から見る', exact: true }).click();
  const body = await screen(page, garden, -0.35, 0.45, 0);
  await page.mouse.move(body.x, body.y); await page.mouse.down();
  await page.mouse.move(body.x - 50, body.y + 35, { steps: 10 }); await page.mouse.up();
  await expect.poll(async () => (await readGarden(request, garden.id)).revision).toBeGreaterThan(garden.revision);
  let next = await readGarden(request, garden.id);
  expect(next.objects[0].position.x).toBeLessThan(-0.1);
  expect(next.objects[0].position.z).toBeGreaterThan(0.1);
  garden = next;
  await page.getByTestId('tool-rotate').click();
  const position = garden.objects[0].position;
  const start = await screen(page, garden, position.x + 1.4, 0.06, position.z);
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    const p = await screen(page, garden, position.x + 1.4 * Math.cos(i * Math.PI / 24), 0.06, position.z + 1.4 * Math.sin(i * Math.PI / 24));
    await page.mouse.move(p.x, p.y);
  }
  await page.mouse.up();
  await expect.poll(async () => (await readGarden(request, garden.id)).revision).toBeGreaterThan(garden.revision);
  next = await readGarden(request, garden.id);
  expect(Math.abs(next.objects[0].rotation.y)).toBeCloseTo(Math.PI / 2, 1);
  garden = next;
  // Reset rotation through the public detail field so the X scale handle is horizontal.
  await page.getByTestId('object-details-toggle').click();
  await page.getByTestId('rotation-y').fill('0');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await readGarden(request, garden.id)).revision).toBeGreaterThan(garden.revision);
  garden = await readGarden(request, garden.id);
  await page.getByTestId('tool-scale').click();
  // The control may flip the local-axis handle towards the camera. Locate the
  // actual red cube instead of assuming which side of the object it occupies.
  const origin = await screen(page, garden, position.x, 0, position.z);
  const canvas = page.locator('[data-testid="garden-canvas"] canvas');
  const bounds = (await canvas.boundingBox())!;
  const handle = await page.evaluate(async ({ png, origin, bounds }) => {
    const image = new Image(); image.src = `data:image/png;base64,${png}`; await image.decode();
    const c = document.createElement('canvas'); c.width = image.width; c.height = image.height;
    const context = c.getContext('2d')!; context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, c.width, c.height).data;
    let best = { x: 0, y: 0, distance: 0 };
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      const distance = Math.hypot(x + bounds.x - origin.x, y + bounds.y - origin.y);
      if (pixels[i] > 180 && pixels[i + 1] < 80 && pixels[i + 2] < 80 && distance > best.distance) best = { x, y, distance };
    }
    const dx = (best.x + bounds.x - origin.x) / best.distance, dy = (best.y + bounds.y - origin.y) / best.distance;
    return { x: best.x + bounds.x - dx * 4, y: best.y + bounds.y - dy * 4, dx, dy, distance: best.distance };
  }, { png: (await canvas.screenshot()).toString('base64'), origin, bounds });
  expect(handle.distance).toBeGreaterThan(15);
  await page.mouse.move(handle.x, handle.y); await page.mouse.down();
  await page.mouse.move(handle.x + handle.dx * 25, handle.y + handle.dy * 25, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await readGarden(request, garden.id)).revision).toBeGreaterThan(garden.revision);
  garden = await readGarden(request, garden.id);
  const scale = garden.objects[0].scale;
  expect(scale.x).toBeGreaterThan(1);
  expect(scale.y).toBe(scale.x); expect(scale.z).toBe(scale.x);
  await page.reload();
  await page.getByRole('button', { name: '3D庭', exact: true }).click();
  await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 1 / 1');
  expect((await readGarden(request, garden.id)).objects).toEqual(garden.objects);
  await mkdir('artifacts/e2e/photo-interaction', { recursive: true });
  await writeFile('artifacts/e2e/photo-interaction/3d-transforms.json', JSON.stringify(garden, null, 2));
  await page.screenshot({ path: 'artifacts/e2e/photo-interaction/3d-transforms-reloaded.png' });
});
