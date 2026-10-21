import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { PerspectiveCamera, Vector3 } from 'three';
import { api } from './api-url.js';
import { shrub } from './occlusion-helpers';
import { createPhotoCamera } from '../frontend/src/three/photoCamera.js';
import type { GardenDocument, ImagePoint, PhotoCalibration } from '../frontend/src/types/garden.js';

const artifacts = resolve('artifacts/e2e/photo-calibration-current');
const source = new PerspectiveCamera(50, 4 / 3, 0.01, 1000);
source.position.set(5, 8, 13); source.lookAt(0, 0, 0); source.updateMatrixWorld(true);
const locations = [[-2.6, 0, 2.5], [0, 0, 0], [2.6, 0, -2.5]];
function project(values: number[], camera = source): ImagePoint {
  const p = new Vector3(...values).project(camera);
  return { x: (p.x + 1) / 2, y: (1 - p.y) / 2 };
}
const corners = [[-5, 0, 4], [5, 0, 4], [5, 0, -4], [-5, 0, -4]].map((p) => project(p));
const requestBody = { imageWidth: 1000, imageHeight: 750, points: corners, referenceWidth: 10, referenceDepth: 8 };

async function clickPoint(page: Page, selector: string, point: ImagePoint) {
  await page.locator(selector).scrollIntoViewIfNeeded();
  const screen = await page.locator(selector).evaluate((element, p) => {
    const v = new DOMPoint(p.x * 1000, p.y * 750).matrixTransform((element as SVGSVGElement).getScreenCTM()!);
    return { x: v.x, y: v.y };
  }, point);
  await page.mouse.click(screen.x, screen.y);
}

// Independent source-camera vertical points detect the failure that ground-only
// reprojection tests miss: a wrong focal length / camera can still fit a plane.
test('O. 既知カメラの写真で校正・高さ投影・写真配置・MySQL保存復元', async ({ page, request }) => {
  await mkdir(artifacts, { recursive: true });
  const created = await request.post(`${api}/gardens`, { data: { name: `E2E camera ${Date.now()}`, width: 10, depth: 8 } });
  expect(created.status()).toBe(201);
  const initial = await created.json() as GardenDocument;
  // Existing saved assets can be placed again from the current shopping list UI.
  // Seed only this starting fixture through the real API; all three measured placements use mouse input.
  // Keep the seed inside both the initial 10x8 and the later 8x6.4 construction boundary.
  const seed = { ...shrub(-3.5, -3), assetId: 'tree_oak' };
  const seeded = await request.put(`${api}/gardens/${initial.id}`, { data: { ...initial, objects: [seed] } });
  expect(seeded.status()).toBe(200);
  {
    await page.goto(`/gardens/${initial.id}`);
    await expect(page.getByTestId('save-status')).toHaveText('保存済み');
    await page.getByRole('button', { name: '写真＋設計', exact: true }).click();
    const rods = locations.map((p) => ({ base: project(p), tip: project([p[0], 1, p[2]]) }));
    const dataUrl = await page.evaluate(({ corners, rods }) => {
      const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 750;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#abc5cf'; ctx.fillRect(0, 0, 1000, 750);
      ctx.fillStyle = '#758b57'; ctx.fillRect(0, 270, 1000, 480);
      ctx.beginPath(); corners.forEach((p, i) => i ? ctx.lineTo(p.x * 1000, p.y * 750) : ctx.moveTo(p.x * 1000, p.y * 750));
      ctx.closePath(); ctx.fillStyle = '#c4bf98'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#f7f3dc'; ctx.stroke();
      for (const { base, tip } of rods) {
        ctx.beginPath(); ctx.moveTo(base.x * 1000, base.y * 750); ctx.lineTo(tip.x * 1000, tip.y * 750);
        ctx.strokeStyle = '#1c5962'; ctx.lineWidth = 5; ctx.stroke();
      }
      ctx.fillStyle = '#172f39'; ctx.font = '24px sans-serif'; ctx.fillText('SYNTHETIC CAMERA / 10 x 8 m / posts: 1 m', 24, 42);
      return canvas.toDataURL('image/png');
    }, { corners, rods });
    await writeFile(resolve(artifacts, 'camera-source.png'), Buffer.from(dataUrl.split(',')[1], 'base64'));
    await page.getByLabel('庭の写真を選択').setInputFiles({ name: 'camera.png', mimeType: 'image/png', buffer: Buffer.from(dataUrl.split(',')[1], 'base64') });
    for (const p of corners) await clickPoint(page, '.photo-stage', p);
    await page.getByTestId('photo-vertex-1').click();
    const uncalibrated = await page.getByTestId('photo-ground').getAttribute('points');
    await page.getByRole('button', { name: '写真のカメラを設定' }).click();
    await expect(page.getByTestId('save-status')).toHaveText('カメラを設定中');
    await expect(page.getByRole('button', { name: '3D庭', exact: true })).toBeDisabled();
    for (const p of corners) await clickPoint(page, '.calibration-stage', p);
    await page.getByRole('button', { name: 'カメラを計算', exact: true }).click();
    await expect(page.getByTestId('calibration-quality')).toBeVisible();
    await page.getByRole('button', { name: 'カメラを適用', exact: true }).click();
    await expect(page.getByTestId('photo-ground')).toHaveAttribute('points', uncalibrated!);
    await expect(page.getByTestId('photo-model-canvas')).toBeVisible();
    await expect(page.getByTestId('photo-vertex-number')).toHaveCount(0);
    // 輪郭の確定後は寸法の編集が開いているため、配置に切り替える。
    await page.getByRole('button', { name: '配置', exact: true }).click();
    // Real pointer rays must recover the same metric coordinates, even after resize.
    await page.setViewportSize({ width: 1280, height: 960 });
    const ids: string[] = [];
    for (const [i, location] of locations.entries()) {
      await page.getByRole('tab', { name: /買い物リスト/ }).click();
      await page.getByTestId('shopping-line-tree_oak').getByRole('button', { name: '庭に配置' }).click();
      await clickPoint(page, '.photo-stage', project(location));
      await page.getByRole('tab', { name: '商品一覧', exact: true }).click();
      await expect(page.getByTestId(`object-row-${i + 1}`)).toBeVisible();
      ids.push((await page.getByTestId(`object-row-${i + 1}`).getAttribute('data-object-id'))!);
    }
    await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 4 / 4');
    await expect(page.getByTestId('save-status')).toHaveText('保存済み');
    let saved = await (await request.get(`${api}/gardens/${initial.id}`)).json() as GardenDocument;
    const calibration = saved.photo!.calibration!;
    expect(calibration.focalSource).toBe('estimated');
    expect(calibration.reprojectionErrorPx).toBeLessThan(2);
    const camera = createPhotoCamera(saved.photo!, saved.width, saved.depth);
    expect(camera).toBeInstanceOf(PerspectiveCamera);
    const sizes: number[] = [];
    for (const [i, location] of locations.entries()) {
      const object = saved.objects.find((o) => o.id === ids[i])!;
      expect(Math.abs(object.position.x - location[0])).toBeLessThan(0.08);
      expect(Math.abs(object.position.z - location[2])).toBeLessThan(0.08);
      const tip = [location[0], 2, location[2]];
      const actual = project(tip, camera as PerspectiveCamera), expected = project(tip);
      expect(Math.hypot((actual.x - expected.x) * 1000, (actual.y - expected.y) * 750)).toBeLessThan(4);
      const bottom = project(location, camera as PerspectiveCamera);
      sizes.push(Math.hypot((actual.x - bottom.x) * 1000, (actual.y - bottom.y) * 750));
    }
    expect(sizes[0]).toBeGreaterThan(sizes[1]); expect(sizes[1]).toBeGreaterThan(sizes[2]);
    const forged = structuredClone(saved);
    forged.photo!.calibration!.rotation.fill(0);
    forged.photo!.calibration!.translation.fill(99999);
    const canonical = await request.put(`${api}/gardens/${initial.id}`, { data: forged });
    expect(canonical.status()).toBe(200);
    saved = await canonical.json() as GardenDocument;
    expect(saved.photo!.calibration).toEqual(calibration);
    await page.reload();
    await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 4 / 4');
    await expect(page.getByTestId('save-status')).toHaveText('保存済み');
    expect(await (await request.get(`${api}/gardens/${initial.id}`)).json()).toEqual(saved);
    await page.screenshot({ path: resolve(artifacts, 'camera-calibrated-reloaded.png'), fullPage: true });
    await writeFile(resolve(artifacts, 'camera-calibrated.json'), JSON.stringify(saved, null, 2));
    await writeFile(resolve(artifacts, 'camera-metrics.json'), JSON.stringify({ sourcePosition: source.position, sourceFov: 50, sizes, calibration }, null, 2));
    await page.getByRole('button', { name: '3D庭', exact: true }).click();
    await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 4 / 4');
    await page.screenshot({ path: resolve(artifacts, 'camera-calibrated-3d.png'), fullPage: true });
    await page.getByRole('button', { name: '写真＋設計', exact: true }).click();
    await page.getByRole('button', { name: '写真のカメラを設定' }).click();
    await page.getByRole('button', { name: '基準点を選び直す' }).click();
    await page.getByRole('button', { name: 'カメラ設定を取消' }).click();
    await expect(page.getByTestId('save-status')).toHaveText('保存済み');
    expect(await (await request.get(`${api}/gardens/${initial.id}`)).json()).toEqual(saved);
    const outline = await page.getByTestId('photo-ground').getAttribute('points');
    await page.getByRole('button', { name: '輪郭と寸法' }).click();
    await page.getByTestId('photo-edge-0').click();
    await expect(page.getByRole('dialog', { name: '選択した辺の長さ' })).toContainText('現在の実寸');
    expect(parseFloat((await page.getByTestId('edge-measurement').textContent())!)).toBeCloseTo(10, 1);
    await expect(page.getByLabel('辺の長さ（m）', { exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('save-status')).toHaveText('保存済み');
    // Change the metric scale in the calibration UI; the photographed outline must stay fixed.
    await page.getByRole('button', { name: '写真のカメラを設定' }).click();
    await page.getByLabel('基準の幅（m）').fill('8');
    await page.getByLabel('基準の奥行き（m）').fill('6.4');
    await expect(page.getByRole('button', { name: 'カメラを適用', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'カメラを計算', exact: true }).click();
    await expect(page.getByTestId('calibration-quality')).toBeVisible();
    await page.getByRole('button', { name: 'カメラを適用', exact: true }).click();
    await expect(page.getByTestId('photo-ground')).toHaveAttribute('points', outline!);
    await page.getByTestId('photo-edge-0').click();
    expect(parseFloat((await page.getByTestId('edge-measurement').textContent())!)).toBeCloseTo(8, 1);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('save-status')).toHaveText('保存済み');
    const edited = await (await request.get(`${api}/gardens/${initial.id}`)).json() as GardenDocument;
    expect(edited.photo!.calibration!.referenceWidth).toBe(8);
    expect(edited.photo!.calibration!.referenceDepth).toBe(6.4);
    expect(edited.photo!.calibration!.points).toEqual(saved.photo!.calibration!.points);
    expect(edited.objects).toEqual(saved.objects);
    expect(edited.photo!.boundary).toEqual(saved.photo!.boundary);
    expect(edited.photo!.corners).toEqual(saved.photo!.corners);
    expect(edited.photo!.projectionSize).toEqual(saved.photo!.projectionSize);
    expect(edited.width).toBe(saved.width);
    expect(edited.depth).toBe(saved.depth);
    await page.reload();
    await page.getByRole('button', { name: '輪郭と寸法' }).click();
    await page.getByTestId('photo-edge-0').click();
    expect(parseFloat((await page.getByTestId('edge-measurement').textContent())!)).toBeCloseTo(8, 1);
    await expect(page.getByTestId('photo-ground')).toHaveAttribute('points', outline!);
    expect(await (await request.get(`${api}/gardens/${initial.id}`)).json()).toEqual(edited);
    await page.screenshot({ path: resolve(artifacts, 'camera-calibrated-measurement.png'), fullPage: true });
    await writeFile(resolve(artifacts, 'camera-calibrated-measurement.json'), JSON.stringify(edited, null, 2));
    await page.keyboard.press('Escape');
    await page.getByTestId('object-details-toggle').click();
    await page.locator('.construction-details > summary').click();
    await expect(page.locator('.construction-details')).toContainText('m²');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /^(AI生成|完成イメージ)メニュー$/ }).click();
    if (!await page.getByRole('button', { name: '完成イメージを確認', exact: true }).isVisible()) await page.getByRole('button', { name: /^(AI生成|完成イメージ)メニュー$/ }).click();
    await page.getByRole('button', { name: '完成イメージを確認', exact: true }).click();
    const completionImage = page.getByAltText('現在の庭の完成イメージ');
    await expect(completionImage).toBeVisible();
    expect(await completionImage.evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBe(edited.photo!.imageWidth);
    await page.screenshot({ path: resolve(artifacts, 'camera-calibrated-completion.png'), fullPage: true });

  }
});

test('P. 不正な基準点と画角の不定性を拒否し、手動画角で復帰', async ({ request }) => {
  const crossed = await request.post(`${api}/photo-calibration`, { data: { ...requestBody, points: [corners[0], corners[2], corners[1], corners[3]] } });
  expect(crossed.status()).toBe(400);
  const overhead = new PerspectiveCamera(50, 4 / 3, 0.01, 1000);
  overhead.position.set(0, 14, 0); overhead.up.set(0, 0, -1); overhead.lookAt(0, 0, 0); overhead.updateMatrixWorld(true);
  const points = [[-5, 0, 4], [5, 0, 4], [5, 0, -4], [-5, 0, -4]].map((p) => project(p, overhead));
  const ambiguous = await request.post(`${api}/photo-calibration`, { data: { ...requestBody, points } });
  expect(ambiguous.status()).toBe(400);
  const manual = await request.post(`${api}/photo-calibration`, { data: { ...requestBody, points, focalLengthPx: 750 / (2 * Math.tan(50 * Math.PI / 360)) } });
  expect(manual.status()).toBe(200);
  const result = await manual.json() as PhotoCalibration;
  expect(result.focalSource).toBe('manual'); expect(result.reprojectionErrorPx).toBeLessThan(0.01);
});
