import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { PerspectiveCamera, Vector3 } from 'three';
import { api } from './api-url.js';
import { createPhotoCamera } from '../frontend/src/three/photoCamera.js';
import type { GardenDocument, GardenPhoto, ImagePoint } from '../frontend/src/types/garden.js';

// 既知のカメラで10×8mの長方形を撮った模擬写真。輪郭と辺の実寸だけからこのカメラを再現できることを確認する。
const directory = resolve('artifacts/e2e');
const camera = new PerspectiveCamera(50, 4 / 3, .01, 1000);
camera.position.set(5, 8, 13); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
const outline = [[-5, 4], [5, 4], [5, -4], [-5, -4]].map(([x, z]) => {
  const point = new Vector3(x, 0, z).project(camera);
  return { x: (point.x + 1) / 2, y: (1 - point.y) / 2 };
});
const xs = outline.map((p) => p.x), ys = outline.map((p) => p.y);
const bounds = [
  { x: Math.min(...xs), y: Math.max(...ys) }, { x: Math.max(...xs), y: Math.max(...ys) },
  { x: Math.max(...xs), y: Math.min(...ys) }, { x: Math.min(...xs), y: Math.min(...ys) },
];

function imageAnchor(document: GardenDocument) {
  const photoCamera = createPhotoCamera(document.photo!, document.width, document.depth)!;
  const position = document.objects[0].position;
  return new Vector3(position.x, 0, position.z).project(photoCamera);
}

// 保存されたカメラで輪郭を地面へ戻し、3D上の実際の辺長を求める。
function groundLengths(photo: GardenPhoto) {
  const c = photo.calibration!, r = c.rotation, t = c.translation;
  const origin = [0, 1, 2].map((i) => -(r[i] * t[0] + r[3 + i] * t[1] + r[6 + i] * t[2]));
  const ground = photo.boundary.map((p: ImagePoint) => {
    const ray = [(p.x - .5) * photo.imageWidth / c.focalLengthPx, (p.y - .5) * photo.imageHeight / c.focalLengthPx, 1];
    const d = [0, 1, 2].map((i) => r[i] * ray[0] + r[3 + i] * ray[1] + r[6 + i] * ray[2]);
    const s = -origin[1] / d[1];
    return [origin[0] + d[0] * s, origin[2] + d[2] * s];
  });
  return { origin, lengths: ground.map((a, i) => { const b = ground[(i + 1) % ground.length]; return Math.hypot(b[0] - a[0], b[1] - a[1]); }) };
}

// 配置物の移動ハンドルが辺の中央に重なる場合があるため、キーボードで辺を選択する。
async function openEdge(page: Page, index: number) {
  await page.getByTestId(`photo-edge-${index}`).focus();
  await page.keyboard.press('Enter');
}

async function edgeLabels(page: Page) {
  return page.locator('.photo-edge .edge-label text').allTextContents();
}

for (const mode of ['legacy', 'fixed-projection', 'calibrated']) {
  test(`辺ごとの実寸入力・ほかの辺と輪郭の固定・パース推定・保存復元 (${mode})`, async ({ page, request }) => {
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
        ctx.fillStyle = '#354638'; ctx.font = '26px sans-serif'; ctx.fillText('EDGE LENGTHS / FIXED OUTLINE', 40, 70);
        return canvas.toDataURL('image/png');
      });
      const photo: GardenPhoto = { dataUrl, imageWidth: 1000, imageHeight: 750, boundary: outline, corners: bounds };
      let width = 12, depth = 10;
      if (mode === 'fixed-projection') { photo.projectionSize = { width: 10, depth: 8 }; width = 14; depth = 12; }
      if (mode === 'calibrated') {
        const response = await request.post(`${api}/photo-calibration`, { data: {
          imageWidth: 1000, imageHeight: 750, points: outline, referenceWidth: 10, referenceDepth: 8,
        } });
        expect(response.status()).toBe(200);
        photo.calibration = await response.json();
        photo.corners = outline;
        width = 10; depth = 8;
      }
      const seed = await request.put(`${api}/gardens/${initial.id}`, { data: {
        ...initial, width, depth, photo,
        objects: [{ id: randomUUID(), assetId: 'tree_oak', position: { x: mode === 'calibrated' ? -1 : -.5, y: 0, z: .5 },
          rotation: { x: 0, y: .3, z: 0 }, scale: { x: .8, y: .8, z: .8 } }],
      } });
      expect(seed.status(), await seed.text()).toBe(200);
      const before = await seed.json() as GardenDocument;
      await page.reload();
      await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 1 / 1');
      // 配置中は頂点と辺の操作を出さない。「輪郭と寸法」に切り替えて編集する。
      await expect(page.locator('[data-testid^="photo-vertex-"]')).toHaveCount(0);
      await expect(page.locator('[data-testid^="photo-edge-"]')).toHaveCount(0);
      const outlineMode = page.getByRole('button', { name: '輪郭と寸法' });
      await expect(outlineMode).toContainText('0/4');
      await outlineMode.click();
      const ground = await page.getByTestId('photo-ground').getAttribute('points');
      const vertices = await page.locator('[data-testid^="photo-vertex-"]').evaluateAll(nodes => nodes.map(node => [node.getAttribute('cx'), node.getAttribute('cy')]));
      const popup = page.getByRole('dialog', { name: '選択した辺の長さ' });
      const field = popup.getByLabel('辺の長さ（m）');

      // 未適用の入力はEsc・取消で破棄する。不正な値は拒否して庭を変更しない。
      await page.getByTestId('photo-edge-0').click();
      await expect(field).toBeFocused();
      await field.fill('12.5');
      await page.keyboard.press('Escape');
      await page.getByTestId('photo-edge-0').click();
      await field.fill('12.5');
      await popup.getByRole('button', { name: '辺の計測を閉じる' }).click();
      await expect(page.getByTestId('save-status')).toHaveText('保存済み');
      await page.getByTestId('photo-edge-0').click();
      for (const invalid of ['', '0', '-1', 'abc', 'Infinity', '9999', '.000001']) {
        await field.fill(invalid);
        await popup.getByRole('button', { name: '長さを適用' }).click();
        await expect(popup.getByRole('alert')).toBeVisible();
      }
      await expect(page.getByTestId('save-status')).toHaveText('保存済み');
      await page.keyboard.press('Escape');

      // 1辺ずつ入力する。入力した辺以外の表示値は一切変わらない。未入力の辺が残る間は次の辺へ進む。
      const truth = [10, 8, 10, 8];
      for (const [index, length] of truth.entries()) {
        const previous = await edgeLabels(page);
        await openEdge(page, index);
        await field.fill(String(length));
        await field.press('Enter');
        if (index < 3) {
          await expect(popup.getByRole('heading')).toHaveText(`辺${index + 2}の長さ`);
          await expect(field).toBeFocused();
          await expect(field).toHaveValue('');
          await expect(page.getByTestId('edge-progress')).toContainText(`${index + 1}/4辺`);
        } else {
          await expect(page.getByTestId('edge-measurement')).toHaveText(`${length.toFixed(2)} m`);
        }
        await expect(popup.locator('p[role="status"]')).toContainText(index < 3 ? `残り${3 - index}辺` : '写真のパースを求めました');
        await page.keyboard.press('Escape');
        const current = await edgeLabels(page);
        expect(current[index]).toBe(`${length.toFixed(2)} m`);
        current.forEach((label, other) => { if (other !== index) expect(label).toBe(previous[other]); });
        await expect(page.getByTestId('photo-ground')).toHaveAttribute('points', ground!);
      }
      await expect(page.getByTestId('save-status')).toHaveText('保存済み');
      const solved = await (await request.get(`${api}/gardens/${initial.id}`)).json() as GardenDocument;
      expect(solved.photo!.edgeLengths).toEqual(truth);
      expect(solved.photo!.calibration!.method).toBe('edges');
      expect(solved.photo!.boundary).toEqual(before.photo!.boundary);
      // カメラ情報を渡さずに、元のカメラの画角・高さを再現する。
      const fov = 2 * Math.atan(375 / solved.photo!.calibration!.focalLengthPx) * 180 / Math.PI;
      expect(fov).toBeCloseTo(50, 2);
      const measured = groundLengths(solved.photo!);
      expect(measured.origin[1]).toBeCloseTo(8, 3);
      measured.lengths.forEach((length, i) => expect(length).toBeCloseTo(truth[i], 3));
      const oldAnchor = imageAnchor(before), newAnchor = imageAnchor(solved);
      expect(Math.abs(oldAnchor.x - newAnchor.x) * 500).toBeLessThan(.1);
      expect(Math.abs(oldAnchor.y - newAnchor.y) * 375).toBeLessThan(.1);
      expect(solved.objects[0].rotation).toEqual(before.objects[0].rotation);
      expect(solved.objects[0].scale).toEqual(before.objects[0].scale);

      // パース推定後に1辺を変更しても、ほかの辺の入力値と3D上の長さ、写真上の輪郭は変わらない。
      const labels = await edgeLabels(page);
      await openEdge(page, 0);
      await field.fill('11');
      await field.press('Enter');
      await expect(page.getByTestId('edge-measurement')).toHaveText('11.00 m');
      await page.keyboard.press('Escape');
      expect(await edgeLabels(page)).toEqual(['11.00 m', ...labels.slice(1)]);
      await expect(page.getByTestId('photo-ground')).toHaveAttribute('points', ground!);
      // 1枚の写真の水平面として成立しない組合せは拒否し、元の状態を保つ。
      await openEdge(page, 2);
      await field.fill('9');
      await field.press('Enter');
      await expect(popup.getByRole('alert')).toContainText('パースを再現できません');
      await page.keyboard.press('Escape');
      expect(await edgeLabels(page)).toEqual(['11.00 m', ...labels.slice(1)]);
      await expect(page.getByTestId('save-status')).toHaveText('保存済み');
      const after = await (await request.get(`${api}/gardens/${initial.id}`)).json() as GardenDocument;
      expect(after.photo!.edgeLengths).toEqual([11, 8, 10, 8]);
      groundLengths(after.photo!).lengths.forEach((length, i) => expect(length).toBeCloseTo([11, 8, 10, 8][i], 3));
      expect(after.photo!.boundary).toEqual(before.photo!.boundary);
      expect(after.photo!.dataUrl).toBe(before.photo!.dataUrl);
      const lastAnchor = imageAnchor(after);
      expect(Math.abs(oldAnchor.x - lastAnchor.x) * 500).toBeLessThan(.1);
      expect(Math.abs(oldAnchor.y - lastAnchor.y) * 375).toBeLessThan(.1);

      await page.reload();
      await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 1 / 1');
      await expect(outlineMode).toContainText('4/4');
      await outlineMode.click();
      expect(await edgeLabels(page)).toEqual(['11.00 m', ...labels.slice(1)]);
      await expect(page.getByTestId('photo-ground')).toHaveAttribute('points', ground!);
      expect(await page.locator('[data-testid^="photo-vertex-"]').evaluateAll(nodes => nodes.map(node => [node.getAttribute('cx'), node.getAttribute('cy')]))).toEqual(vertices);
      await mkdir(directory, { recursive: true });
      await page.screenshot({ path: resolve(directory, `photo-scale-${mode}.png`), fullPage: true });
      await writeFile(resolve(directory, `photo-scale-${mode}.json`), JSON.stringify({ before, solved, after }, null, 2));
      await page.setViewportSize({ width: 390, height: 844 });
      await openEdge(page, 1);
      await field.scrollIntoViewIfNeeded();
      await expect(field).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: resolve(directory, `photo-scale-mobile-${mode}.png`), fullPage: true });
    } finally {
      expect((await request.delete(`${api}/gardens/${initial.id}`)).status()).toBe(204);
    }
  });
}
