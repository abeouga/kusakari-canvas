import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { PerspectiveCamera, Vector3 } from 'three';
import { api } from './api-url';
import { createPhotoCamera } from '../frontend/src/three/photoCamera.js';
import { syntheticPhoto, createScene, openScene, readGarden, shrub, capture } from './occlusion-helpers';
import type { GardenDocument } from '../frontend/src/types/garden';

async function point(page: Page, garden: GardenDocument, x: number, y: number, z: number) {
  const camera = createPhotoCamera(garden.photo!, garden.width, garden.depth)!;
  const p = new Vector3(x, y, z).project(camera);
  const bounds = (await page.locator('[data-testid="photo-model-canvas"] canvas').boundingBox())!;
  return { x: bounds.x + (p.x + 1) * bounds.width / 2, y: bounds.y + (1 - p.y) * bounds.height / 2 };
}

test('photo selection switches through the selected outline', async ({ page, request }) => {
  await page.goto('/');
  const photo = await syntheticPhoto(page);
  const garden = await createScene(request, [], photo, [shrub(0, 0, 3), shrub(2.1, 0, 0.7)]);
  await openScene(page, garden);
  const large = garden.objects.find(o => o.scale.x === 3)!;
  const small = garden.objects.find(o => o.scale.x === 0.7)!;
  await page.locator(`[data-object-id="${large.id}"]`).click();
  // The second plant lies near the selected large plant's outline. Its visible
  // geometry must remain selectable, regardless of the decorative line hit radius.
  const p = await point(page, garden, 2.1, 0.35, 0);
  await page.mouse.click(p.x, p.y);
  await expect(page.locator(`[data-object-id="${small.id}"]`)).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await openScene(page, garden);
  await evidence(page, await readGarden(request, garden.id), 'selection');
});

test('3d view survives an autosave', async ({ page, request }) => {
  await page.goto('/');
  const garden = await createScene(request, [], await syntheticPhoto(page), [shrub(0, 0)]);
  await openScene(page, garden);
  await page.getByRole('button', { name: '3D庭', exact: true }).click();
  await page.getByTestId('object-details-toggle').click();
  await page.getByTestId('position-x').fill('1');
  await expect.poll(async () => (await readGarden(request, garden.id)).revision).toBeGreaterThan(garden.revision);
  await expect(page.getByRole('button', { name: '3D庭', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await mkdir('artifacts/e2e/photo-interaction', { recursive: true });
  await writeFile('artifacts/e2e/photo-interaction/garden.json', JSON.stringify(await readGarden(request, garden.id), null, 2));
  await page.reload();
  await expect(page.getByTestId('photo-model-canvas')).toBeVisible();
  await page.screenshot({ path: 'artifacts/e2e/photo-interaction/reloaded.png' });
  await page.getByRole('button', { name: '3D庭', exact: true }).click();
  await page.locator('.document-identity button').click();
  await page.waitForURL('/');
  await page.locator('.garden-card').filter({ hasText: garden.name }).locator('.garden-card-open').click();
  await expect(page.getByTestId('photo-model-canvas')).toBeVisible();
});

for (const calibrated of [false, true]) {
  test(`photo dragging, handles, cancellation and restoration (${calibrated ? 'calibrated' : 'legacy'})`, async ({ page, request }) => {
    await page.goto('/');
    const photo = await syntheticPhoto(page);
    if (calibrated) {
      const camera = new PerspectiveCamera(50, 1.5, 0.01, 1000);
      camera.position.set(10, 16, 26); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
      photo.corners = [[-10, 0, 8], [10, 0, 8], [10, 0, -8], [-10, 0, -8]].map(v => {
        const p = new Vector3(...v).project(camera);
        return { x: (p.x + 1) / 2, y: (1 - p.y) / 2 };
      });
      photo.boundary = photo.corners;
      const response = await request.post(`${api}/photo-calibration`, { data: {
        imageWidth: 1200, imageHeight: 800, points: photo.corners, referenceWidth: 20, referenceDepth: 16,
      } });
      expect(response.ok(), await response.text()).toBeTruthy();
      photo.calibration = await response.json();
    }
    let garden = await createScene(request, [], photo, [shrub(0, 0), shrub(-3, 1, 0.7)]);
    // The API may return objects in UUID order; explicitly identify the subject.
    const subjectId = garden.objects.find(o => o.scale.x === 1)!.id;
    const ordered = (g: GardenDocument) => ({ ...g, objects: [...g.objects].sort((a, b) => Number(b.id === subjectId) - Number(a.id === subjectId)) });
    garden = ordered(garden);
    await openScene(page, garden);
    await page.locator(`[data-object-id="${subjectId}"]`).click();
    const puts: string[] = [];
    page.on('request', r => { if (r.method() === 'PUT' && r.url().endsWith(`/gardens/${garden.id}`)) puts.push(r.url()); });
    for (const viewport of [{ width: 1440, height: 960 }, { width: 1100, height: 800 }]) {
      await page.setViewportSize(viewport);
      await page.getByRole('separator', { name: '商品サイドバーの幅' }).focus();
      await page.keyboard.press('ArrowLeft');
      const object = garden.objects[0];
      const body = await point(page, garden, object.position.x, 0.8, object.position.z);
      await page.mouse.click(body.x, body.y);
      expect(ordered(await readGarden(request, garden.id)).objects).toEqual(garden.objects);
      const beforeCount = puts.length;
      await page.mouse.move(body.x, body.y); await page.mouse.down();
      await page.mouse.move(body.x + 35, body.y + 20, { steps: 8 });
      await expect(page.getByRole('button', { name: '3D庭', exact: true })).toBeDisabled();
      await expect(page.getByRole('checkbox', { name: '配置', exact: true })).toBeDisabled();
      await page.waitForTimeout(650);
      expect(puts.length).toBe(beforeCount);
      await page.mouse.up();
      await expect.poll(async () => (await readGarden(request, garden.id)).revision).toBeGreaterThan(garden.revision);
      const moved = ordered(await readGarden(request, garden.id));
      expect(moved.objects[0].position).not.toEqual(object.position);
      expect(moved.objects[0].position.y).toBe(0);
      expect(moved.objects[1]).toEqual(garden.objects[1]);
      garden = moved;
      // A real handle drag, located from the rendered arrow colour, not store state.
      for (const axis of ['x', 'z'] as const) {
        await page.mouse.move(5, 5);
        const tip = await arrow(page, garden, axis);
        const start = garden.objects[0].position;
        const origin = await point(page, garden, start.x, 0, start.z);
        const target = await point(page, garden, start.x + (axis === 'x' ? 1 : 0), 0, start.z + (axis === 'z' ? 1 : 0));
        await page.mouse.move(tip.x, tip.y); await page.mouse.down();
        await page.mouse.move(tip.x + target.x - origin.x, tip.y + target.y - origin.y, { steps: 8 });
        await page.mouse.up();
        await expect.poll(async () => (await readGarden(request, garden.id)).revision).toBeGreaterThan(garden.revision);
        const moved = ordered(await readGarden(request, garden.id));
        // Perspective displacement depends on the arrow's depth, not just the origin.
        expect(moved.objects[0].position[axis] - start[axis]).toBeGreaterThan(0.5);
        expect(moved.objects[0].position[axis] - start[axis]).toBeLessThan(1.5);
        expect(moved.objects[0].position[axis === 'x' ? 'z' : 'x']).toBeCloseTo(start[axis === 'x' ? 'z' : 'x'], 4);
        garden = moved;
      }
    }
    for (const cancel of ['Escape', 'pointercancel', 'blur']) {
      const body = await point(page, garden, garden.objects[0].position.x, 0.8, garden.objects[0].position.z);
      await page.mouse.move(body.x, body.y); await page.mouse.down();
      await page.mouse.move(body.x - 30, body.y - 20, { steps: 5 });
      if (cancel === 'Escape') await page.keyboard.press('Escape');
      else await page.evaluate(type => window.dispatchEvent(new Event(type)), cancel);
      await page.mouse.up();
      await expect(page.getByRole('button', { name: '3D庭', exact: true })).toBeEnabled();
      await page.waitForTimeout(650);
      expect(ordered(await readGarden(request, garden.id)).objects).toEqual(garden.objects);
    }
    const handle = await arrow(page, garden, 'x');
    await page.mouse.move(handle.x, handle.y); await page.mouse.down();
    await page.mouse.move(handle.x + 20, handle.y, { steps: 5 });
    await expect(page.getByRole('button', { name: '3D庭', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape'); await page.mouse.up();
    await expect(page.getByRole('button', { name: '3D庭', exact: true })).toBeEnabled();
    await page.waitForTimeout(650);
    expect(ordered(await readGarden(request, garden.id)).objects).toEqual(garden.objects);
    const other = await point(page, garden, -3, 0.5, 1);
    await page.mouse.click(other.x, other.y);
    await expect(page.locator(`[data-object-id="${garden.objects[1].id}"]`)).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('checkbox', { name: '配置', exact: true }).uncheck();
    await expect(page.getByTestId('photo-model-canvas')).toHaveAttribute('data-object-count', '0');
    await page.getByRole('checkbox', { name: '配置', exact: true }).check();
    const firstCapture = await capture(page);
    await page.keyboard.press('Escape');
    await page.locator(`[data-object-id="${subjectId}"]`).click();
    const secondCapture = await capture(page);
    expect(secondCapture.before).toBe(firstCapture.before);
    await page.keyboard.press('Escape');
    await page.reload();
    await openScene(page, garden);
    expect(ordered(await readGarden(request, garden.id)).objects).toEqual(garden.objects);
    await mkdir('artifacts/e2e/photo-interaction', { recursive: true });
    const name = calibrated ? 'calibrated' : 'legacy';
    await writeFile(`artifacts/e2e/photo-interaction/${name}.json`, JSON.stringify(garden, null, 2));
    await page.screenshot({ path: `artifacts/e2e/photo-interaction/${name}-reloaded.png` });
  });
}

async function evidence(page: Page, garden: GardenDocument, name: string) {
  await mkdir('artifacts/e2e/photo-interaction', { recursive: true });
  await writeFile(`artifacts/e2e/photo-interaction/${name}.json`, JSON.stringify(garden, null, 2));
  await page.screenshot({ path: `artifacts/e2e/photo-interaction/${name}-reloaded.png` });
}

test('photo movement clamps the anchor to garden bounds', async ({ page, request }) => {
  await page.goto('/');
  let garden = await createScene(request, [], await syntheticPhoto(page), [shrub(0, 0)]);
  const resized = await request.put(`${api}/gardens/${garden.id}`, { data: { ...garden, width: 10, depth: 8 } });
  expect(resized.ok()).toBeTruthy(); garden = await resized.json();
  await openScene(page, garden);
  const body = await point(page, garden, 0, 0.8, 0);
  await page.mouse.move(body.x, body.y); await page.mouse.down();
  await page.mouse.move(1500, body.y, { steps: 12 }); await page.mouse.up();
  await expect.poll(async () => (await readGarden(request, garden.id)).objects[0].position.x).toBe(5);
  await page.reload(); await openScene(page, garden);
  await evidence(page, await readGarden(request, garden.id), 'bounds');
});

async function arrow(page: Page, garden: GardenDocument, axis: 'x' | 'z') {
  const canvas = page.locator('[data-testid="photo-model-canvas"] canvas');
  const bounds = (await canvas.boundingBox())!;
  const origin = await point(page, garden, garden.objects[0].position.x, 0, garden.objects[0].position.z);
  const png = (await canvas.screenshot()).toString('base64');
  const tip = await page.evaluate(async ({ png, axis, ox, oy }) => {
    const image = new Image(); image.src = `data:image/png;base64,${png}`; await image.decode();
    const c = document.createElement('canvas'); c.width = image.width; c.height = image.height;
    const ctx = c.getContext('2d')!; ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    let best = { x: 0, y: 0, distance: 0 };
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      const match = axis === 'x' ? data[i] > 180 && data[i + 1] < 100 && data[i + 2] < 100
        : data[i + 2] > 180 && data[i] < 100 && data[i + 1] < 100;
      const distance = Math.hypot(x - ox, y - oy);
      if (match && distance < 160 && distance > best.distance) best = { x, y, distance };
    }
    return best;
  }, { png, axis, ox: origin.x - bounds.x, oy: origin.y - bounds.y });
  expect(tip.distance, `visible ${axis} arrow`).toBeGreaterThan(8);
  // Aim inside the arrowhead, not its outer antialiased pixel (which can lie
  // outside the mesh's actual hit surface after SVG scaling).
  const x = bounds.x + tip.x, y = bounds.y + tip.y;
  return { x: x + (origin.x - x) * 4 / tip.distance, y: y + (origin.y - y) * 4 / tip.distance };
}
