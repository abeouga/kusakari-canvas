import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Mesh, MeshStandardMaterial } from 'three';
import { api } from './api-url.js';

// Detect repeated GPU resources, broken cutout leaves, oversized downloads and
// mutations of other trees. Timings are evidence, not a machine-dependent pass threshold.
test('TREE50. Blender樹木50本の共有描画・独立編集・MySQL保存復元', async ({ page, request }) => {
  const response = await request.post(`${api}/gardens`, {
    data: { name: `Blender fifty ${Date.now()}`, width: 26, depth: 14 },
  });
  expect(response.ok()).toBe(true);
  const garden = await response.json();
  const objects = Array.from({ length: 50 }, (_, index) => ({
    id: randomUUID(), assetId: 'tree_oak',
    position: { x: -10.8 + index % 10 * 2.4, y: 0, z: -4.8 + Math.floor(index / 10) * 2.4 },
    rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
  }));
  const errors: string[] = [];
  const downloads: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (entry) => {
    if (new URL(entry.url()).pathname === '/models/tree-oak.glb') downloads.push(entry.url());
  });
  try {
    const stored = await request.put(`${api}/gardens/${garden.id}`, { data: { ...garden, objects } });
    expect(stored.ok()).toBe(true);
    await page.goto(`/gardens/${garden.id}`);
    await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 50 / 50');
    expect(downloads).toHaveLength(1);
    const model = await page.request.get('/models/tree-oak.glb');
    expect((await model.body()).length).toBeLessThan(220 * 1024);

    const report = await page.evaluate(async () => {
      const moduleUrl = performance.getEntriesByType('resource').map((entry) => entry.name)
        .find((url) => url.includes('/@react-three_fiber.js'));
      const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="garden-canvas"] canvas');
      if (!moduleUrl || !canvas) throw new Error('3D renderer is missing.');
      const fiber = await import(moduleUrl) as typeof import('@react-three/fiber');
      const root = fiber._roots.get(canvas);
      if (!root) throw new Error('3D renderer root is missing.');
      const state = root.store.getState();
      const meshes: Mesh[] = [];
      state.scene.traverse((node) => {
        if (node.name.startsWith('Oak') && (node as Mesh).isMesh) meshes.push(node as Mesh);
      });
      const surfaces = meshes.map((mesh) => mesh.material as MeshStandardMaterial);
      const leaves = surfaces.find((surface) => surface.name === 'Oak foliage');
      const intervals: number[] = [];
      let previous = performance.now();
      for (let index = 0; index < 120; index += 1) {
        await new Promise(requestAnimationFrame);
        const now = performance.now();
        intervals.push(now - previous);
        previous = now;
      }
      const average = intervals.slice(10).reduce((sum, value) => sum + value, 0) / 110;
      return {
        meshes: meshes.length,
        geometries: new Set(meshes.map((mesh) => mesh.geometry)).size,
        materials: new Set(surfaces).size,
        textures: new Set(surfaces.map((surface) => surface.map)).size,
        alphaTest: leaves?.alphaTest, transparent: leaves?.transparent,
        calls: state.gl.info.render.calls, triangles: state.gl.info.render.triangles,
        estimatedFps: 1000 / average,
      };
    });
    expect(report.meshes).toBe(100);
    expect(report.geometries).toBe(2);
    expect(report.materials).toBe(2);
    expect(report.textures).toBe(2);
    expect(report.alphaTest).toBe(0.5);
    expect(report.transparent).toBe(false);
    expect(report.calls).toBeLessThan(130);
    expect(report.triangles).toBeLessThan(280_000);

    await page.getByTestId('object-row-0').click();
    const changedId = await page.getByTestId('object-row-0').getAttribute('data-object-id');
    if (!await page.locator('.object-details').evaluate((element) => (element as HTMLDetailsElement).open)) await page.getByTestId('object-details-toggle').click();
    await page.getByTestId('position-x').fill('-10');
    if (!await page.locator('.object-details').evaluate((element) => (element as HTMLDetailsElement).open)) await page.getByTestId('object-details-toggle').click();
    await page.getByTestId('rotation-y').fill('45');
    if (!await page.locator('.object-details').evaluate((element) => (element as HTMLDetailsElement).open)) await page.getByTestId('object-details-toggle').click();
    await page.getByTestId('uniform-scale').fill('1.1');
    await expect(page.getByTestId('save-status')).toHaveText('保存済み');
    await page.reload();
    await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 50 / 50');
    const restored = await (await request.get(`${api}/gardens/${garden.id}`)).json();
    expect(restored.objects).toHaveLength(50);
    for (const original of objects) {
      const actual = restored.objects.find((object: { id: string }) => object.id === original.id);
      if (original.id === changedId) {
        expect(actual.position.x).toBe(-10);
        expect(actual.rotation.y).toBeCloseTo(Math.PI / 4, 5);
        expect(actual.scale).toEqual({ x: 1.1, y: 1.1, z: 1.1 });
      } else {
        expect(actual).toEqual(original);
      }
    }
    await page.getByRole('button', { name: '初期視点', exact: true }).click();
    await mkdir('artifacts/e2e', { recursive: true });
    await page.screenshot({ path: 'artifacts/e2e/tree-50-e2e.png', fullPage: true });
    await writeFile('artifacts/e2e/tree-50-e2e.json', JSON.stringify({ report, restored, errors }, null, 2));
    expect(errors).toEqual([]);
  } finally {
    await request.delete(`${api}/gardens/${garden.id}`);
  }
});
