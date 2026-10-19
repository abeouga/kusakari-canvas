import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { PerspectiveCamera, Vector3 } from 'three';
import { api } from './api-url.js';
import { createPhotoCamera } from '../frontend/src/three/photoCamera.js';
import type { GardenDocument, GardenPhoto } from '../frontend/src/types/garden.js';

const directory = resolve('artifacts/e2e');
const polygon = [{ x: .2, y: .8 }, { x: .8, y: .8 }, { x: .8, y: .5 }, { x: .55, y: .5 }, { x: .55, y: .2 }, { x: .2, y: .2 }];
const rectangle = [{ x: .2, y: .8 }, { x: .8, y: .8 }, { x: .8, y: .2 }, { x: .2, y: .2 }];

function imageAnchor(document: GardenDocument) {
  const camera = createPhotoCamera(document.photo!, document.width, document.depth)!;
  const position = document.objects[0].position;
  return new Vector3(position.x, 0, position.z).project(camera);
}

for (const mode of ['legacy', 'fixed-projection', 'calibrated']) {
  test(`辺の実寸編集・輪郭固定・縮尺・保存復元 (${mode})`, async ({ page, request }) => {
    const created = await request.post(`${api}/gardens`, { data: { name: `辺の実寸編集 ${mode} ${Date.now()}` } });
    expect(created.status()).toBe(201);
    const initial = await created.json() as GardenDocument;
    try {
      await page.goto(`/gardens/${initial.id}`);
      const dataUrl = await page.evaluate(() => {
        const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 750;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#b5c9d0'; ctx.fillRect(0, 0, 1000, 750);
        ctx.fillStyle = '#8b9c72'; ctx.fillRect(0, 250, 1000, 500);
        ctx.fillStyle = '#d9d2bd'; ctx.fillRect(180, 350, 670, 260);
        ctx.fillStyle = '#354638'; ctx.font = '26px sans-serif'; ctx.fillText('PHOTO SCALE / FIXED OUTLINE', 40, 70);
        return canvas.toDataURL('image/png');
      });
      const photo: GardenPhoto = { dataUrl, imageWidth: 1000, imageHeight: 750, boundary: polygon, corners: rectangle };
      if (mode === 'fixed-projection') photo.projectionSize = { width: 10, depth: 8 };
      if (mode === 'calibrated') {
        const camera = new PerspectiveCamera(50, 4 / 3, .01, 1000);
        camera.position.set(5, 8, 13); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
        const points = [[-5, 4], [5, 4], [5, -4], [-5, -4]].map(([x, z]) => {
          const point = new Vector3(x, 0, z).project(camera);
          return { x: (point.x + 1) / 2, y: (1 - point.y) / 2 };
        });
        const response = await request.post(`${api}/photo-calibration`, { data: {
          imageWidth: 1000, imageHeight: 750, points, referenceWidth: 10, referenceDepth: 8,
        } });
        expect(response.status()).toBe(200);
        photo.calibration = await response.json();
        photo.boundary = points;
        photo.corners = points;
      }
      const seed = await request.put(`${api}/gardens/${initial.id}`, { data: {
        ...initial, width: mode === 'fixed-projection' ? 14 : 10,
        depth: mode === 'fixed-projection' ? 12 : 8, photo,
        objects: [{ id: randomUUID(), assetId: 'tree_oak', position: { x: -1, y: 0, z: 1 },
          rotation: { x: 0, y: .3, z: 0 }, scale: { x: .8, y: .8, z: .8 } }],
      } });
      expect(seed.status(), await seed.text()).toBe(200);
      const before = await seed.json() as GardenDocument;
      await page.reload();
      await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 1 / 1');
      const outline = await page.getByTestId('photo-ground').getAttribute('points');
      const vertices = await page.locator('[data-testid^="photo-vertex-"]').evaluateAll(nodes => nodes.map(node => [node.getAttribute('cx'), node.getAttribute('cy')]));
      const popup = page.getByRole('dialog', { name: '選択した辺の長さ' });
      const field = popup.getByLabel('辺の長さ（m）');
      await page.getByTestId('photo-edge-0').click();
      await expect(field).toBeFocused();
      expect(await field.evaluate(node => (node as HTMLInputElement).selectionEnd! - (node as HTMLInputElement).selectionStart!)).toBeGreaterThan(0);
      await field.fill('12.5');
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('save-status')).toHaveText('保存済み');
      await page.getByTestId('photo-edge-0').click();
      await field.fill('12.5');
      await popup.getByRole('button', { name: '取消', exact: true }).click();
      await expect(page.getByTestId('save-status')).toHaveText('保存済み');
      await page.getByTestId('photo-edge-0').click();
      for (const invalid of ['', '0', '-1', 'abc', 'Infinity', '9999', '.000001']) {
        await field.fill(invalid);
        await popup.getByRole('button', { name: '長さを適用' }).click();
        await expect(popup.getByRole('alert')).toBeVisible();
        await expect(page.getByTestId('save-status')).toHaveText('保存済み');
        await expect(page.getByTestId('photo-ground')).toHaveAttribute('points', outline!);
      }
      await field.fill('12.5');
      await field.press('Enter');
      await expect(page.getByTestId('edge-measurement')).toHaveText('12.50 m');
      await expect(page.getByTestId('save-status')).toHaveText('保存済み');
      await expect(popup).toBeVisible();
      await page.keyboard.press('Escape');
      await page.getByTestId('photo-edge-1').click();
      const secondLength = mode === 'calibrated' ? 8 : 4;
      expect(parseFloat((await page.getByTestId('edge-measurement').textContent())!)).toBeCloseTo(secondLength * 1.25, 2);
      await field.fill(String(secondLength * 1.5));
      await field.press('Enter');
      await page.keyboard.press('Escape');
      await page.getByTestId('object-details-toggle').click();
      await page.locator('.construction-details > summary').click();
      const summary = page.locator('.construction-details');
      const expectedArea = mode === 'calibrated' ? 180 : 142.5;
      await expect(summary).toContainText(`面積：${expectedArea.toFixed(2)} m²`);
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('save-status')).toHaveText('保存済み');
      const after = await (await request.get(`${api}/gardens/${initial.id}`)).json() as GardenDocument;
      expect(after.width).toBeCloseTo(before.width * 1.5, 4);
      expect(after.depth).toBeCloseTo(before.depth * 1.5, 4);
      expect(after.photo!.boundary).toEqual(before.photo!.boundary);
      expect(after.photo!.corners).toEqual(before.photo!.corners);
      expect(after.photo!.dataUrl).toBe(before.photo!.dataUrl);
      const object = after.objects[0];
      expect(object.id).toBe(before.objects[0].id);
      expect(object.rotation).toEqual(before.objects[0].rotation);
      expect(object.scale).toEqual(before.objects[0].scale);
      expect(object.position.x).toBeCloseTo(-1.5, 4);
      expect(object.position.z).toBeCloseTo(1.5, 4);
      const oldAnchor = imageAnchor(before), newAnchor = imageAnchor(after);
      expect(Math.abs(oldAnchor.x - newAnchor.x) * 500).toBeLessThan(.1);
      expect(Math.abs(oldAnchor.y - newAnchor.y) * 375).toBeLessThan(.1);
      if (before.photo!.projectionSize) {
        expect(after.photo!.projectionSize!.width).toBeCloseTo(15, 4);
        expect(after.photo!.projectionSize!.depth).toBeCloseTo(12, 4);
      }
      if (before.photo!.calibration) {
        const first = before.photo!.calibration, last = after.photo!.calibration!;
        expect(last.points).toEqual(first.points);
        expect(last.referenceWidth).toBeCloseTo(15, 4);
        expect(last.referenceDepth).toBeCloseTo(12, 4);
        expect(last.focalLengthPx).toBeCloseTo(first.focalLengthPx, 2);
        for (let i = 0; i < 9; i++) expect(last.rotation[i]).toBeCloseTo(first.rotation[i], 4);
        for (let i = 0; i < 3; i++) expect(last.translation[i]).toBeCloseTo(first.translation[i] * 1.5, 3);
      }
      await page.reload();
      await page.getByTestId('photo-edge-0').click();
      await expect(page.getByTestId('edge-measurement')).toHaveText('15.00 m');
      await expect(page.getByTestId('photo-ground')).toHaveAttribute('points', outline!);
      expect(await page.locator('[data-testid^="photo-vertex-"]').evaluateAll(nodes => nodes.map(node => [node.getAttribute('cx'), node.getAttribute('cy')]))).toEqual(vertices);
      await mkdir(directory, { recursive: true });
      await page.screenshot({ path: resolve(directory, `photo-scale-${mode}.png`), fullPage: true });
      await writeFile(resolve(directory, `photo-scale-${mode}.json`), JSON.stringify({ before, after }, null, 2));
      await page.setViewportSize({ width: 390, height: 844 });
      await field.scrollIntoViewIfNeeded();
      await expect(field).toBeVisible();
      await field.fill('15');
      await popup.getByRole('button', { name: '長さを適用' }).click();
      await expect(page.getByTestId('save-status')).toHaveText('保存済み');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: resolve(directory, `photo-scale-mobile-${mode}.png`), fullPage: true });
    } finally {
      expect((await request.delete(`${api}/gardens/${initial.id}`)).status()).toBe(204);
    }
  });
}
