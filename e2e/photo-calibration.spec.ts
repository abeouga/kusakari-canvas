import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type APIRequestContext, type Locator, type Page } from './test.js';
import { PerspectiveCamera, Vector3 } from 'three';
import { api } from './api-url.js';
import { shrub, syntheticPhoto } from './occlusion-helpers.js';
import { rectangleCalibration } from './rectangle-calibration.js';
import { createPhotoCamera } from '../frontend/src/three/photoCamera.js';
import type { GardenDocument, GardenPhoto, ImagePoint } from '../frontend/src/types/garden.js';

const artifacts = resolve('artifacts/e2e/photo-calibration-current');
const source = new PerspectiveCamera(50, 4 / 3, 0.01, 1000);
source.position.set(5, 8, 13); source.lookAt(0, 0, 0); source.updateMatrixWorld(true);
const locations = [[-2.6, 0, 2.5], [0, 0, 0], [2.6, 0, -2.5]];
function project(values: number[], camera = source): ImagePoint {
  const p = new Vector3(...values).project(camera);
  return { x: (p.x + 1) / 2, y: (1 - p.y) / 2 };
}
const corners = [[-5, 0, 4], [5, 0, 4], [5, 0, -4], [-5, 0, -4]].map((p) => project(p));

// 写真上の地点（画像座標）へ、買い物リストのカードを実マウスでドラッグして配置する。
async function dropAtPoint(page: Page, source: Locator, point: ImagePoint) {
  const target = page.getByTestId('photo-model-canvas').locator('canvas');
  await page.locator('.photo-stage').scrollIntoViewIfNeeded();
  const screen = await page.locator('.photo-stage').evaluate((element, p) => {
    const v = new DOMPoint(p.x * 1000, p.y * 750).matrixTransform((element as SVGSVGElement).getScreenCTM()!);
    return { x: v.x, y: v.y };
  }, point);
  const bounds = (await target.boundingBox())!;
  await source.dragTo(target, { sourcePosition: { x: 35, y: 35 }, targetPosition: { x: screen.x - bounds.x, y: screen.y - bounds.y } });
}

async function createGarden(request: APIRequestContext, name: string) {
  const created = await request.post(`${api}/gardens`, { data: { name: `${name} ${Date.now()}`, width: 10, depth: 8 } });
  expect(created.status()).toBe(201);
  return await created.json() as GardenDocument;
}

// 基準長方形のカメラは今の画面からは作れず、以前のカメラ設定画面で保存された庭にだけ残っている。
// そのような庭を実API・専用MySQLに用意し、開く・写真上で配置する・保存して戻す流れが壊れていないことを確かめる。
// 基準点にしていない高さ2mの点を元のカメラと比べるのは、地面だけの再投影では誤った焦点距離・カメラでも平面に合ってしまうためである。
test('O. 基準長方形のカメラで保存された庭の高さ投影・写真配置・MySQL保存復元', async ({ page, request }) => {
  await mkdir(artifacts, { recursive: true });
  const initial = await createGarden(request, 'E2E camera');
  await page.goto(`/gardens/${initial.id}`);
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
  const photo: GardenPhoto = { dataUrl, imageWidth: 1000, imageHeight: 750, corners, boundary: corners,
    calibration: rectangleCalibration(corners, 10, 8) };
  const seeded = await request.put(`${api}/gardens/${initial.id}`, { data: {
    ...initial, photo, objects: [{ ...shrub(-3.5, -3), assetId: 'tree_oak' }],
  } });
  expect(seeded.status(), await seeded.text()).toBe(200);
  await page.reload();
  await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 1 / 1');
  await expect(page.getByTestId('save-status')).toHaveText('保存済み');
  await expect(page.getByTestId('photo-model-canvas')).toBeVisible();
  // カメラ設定画面の入口はなく、写真のツールバーには写真の変更と取り外しだけが残る。
  await expect(page.getByRole('button', { name: '写真のカメラを設定' })).toHaveCount(0);
  const photoTools = page.getByRole('group', { name: '写真', exact: true }).getByRole('button');
  await expect(photoTools).toHaveCount(2);
  await expect(photoTools.nth(0)).toHaveAccessibleName('写真を変更');
  await expect(photoTools.nth(1)).toHaveAccessibleName('写真を外す');
  // Real pointer rays must recover the same metric coordinates, even after resize.
  await page.setViewportSize({ width: 1280, height: 960 });
  const ids: string[] = [];
  for (const [i, location] of locations.entries()) {
    await page.getByRole('tab', { name: /買い物リスト/ }).click();
    await dropAtPoint(page, page.getByTestId('shopping-line-tree_oak'), project(location));
    await page.getByRole('tab', { name: '商品一覧', exact: true }).click();
    await expect(page.getByTestId(`object-row-${i + 1}`)).toBeVisible();
    ids.push((await page.getByTestId(`object-row-${i + 1}`).getAttribute('data-object-id'))!);
  }
  await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 4 / 4');
  await expect(page.getByTestId('save-status')).toHaveText('保存済み');
  let saved = await (await request.get(`${api}/gardens/${initial.id}`)).json() as GardenDocument;
  const calibration = saved.photo!.calibration!;
  expect(calibration.method).toBeUndefined();
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
  // 保存のたびに基準点からカメラを計算し直し、クライアントの行列をそのまま使わない。
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
  const outline = await page.getByTestId('photo-ground').getAttribute('points');
  await page.getByRole('button', { name: '輪郭と寸法' }).click();
  // 基準長方形のカメラを持つ庭では、パースと面積・外周がその実寸から求めたものだと示す。
  await expect(page.getByText('パース：基準長方形から推定')).toBeVisible();
  await expect(page.getByTestId('ground-summary')).toContainText('m²');
  await expect(page.getByTestId('ground-summary')).toHaveAttribute('title', '写真の基準長方形の実寸から求めたパースに基づく推定');
  await page.getByTestId('photo-edge-0').click();
  await expect(page.getByRole('dialog', { name: '選択した辺の長さ' })).toContainText('現在の実寸');
  expect(parseFloat((await page.getByTestId('edge-measurement').textContent())!)).toBeCloseTo(10, 1);
  await expect(page.getByLabel('辺の長さ（m）', { exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('photo-ground')).toHaveAttribute('points', outline!);
  await expect(page.getByTestId('save-status')).toHaveText('保存済み');
  expect(await (await request.get(`${api}/gardens/${initial.id}`)).json()).toEqual(saved);
  await page.screenshot({ path: resolve(artifacts, 'camera-calibrated-measurement.png'), fullPage: true });
  await page.getByRole('button', { name: /^(AI生成|完成イメージ)メニュー$/ }).click();
  if (!await page.getByRole('button', { name: '完成イメージを確認', exact: true }).isVisible()) await page.getByRole('button', { name: /^(AI生成|完成イメージ)メニュー$/ }).click();
  await page.getByRole('button', { name: '完成イメージを確認', exact: true }).click();
  const completionImage = page.getByAltText('現在の庭の完成イメージ');
  await expect(completionImage).toBeVisible();
  expect(await completionImage.evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBe(saved.photo!.imageWidth);
  await page.screenshot({ path: resolve(artifacts, 'camera-calibrated-completion.png'), fullPage: true });
});

// 基準長方形のカメラを持つ庭の保存では、基準点から計算し直せないカメラを受け付けない。
test('P. 保存時に不正な基準点と画角の不定性を拒否し、手動画角のカメラは計算し直して保存', async ({ page, request }) => {
  await page.goto('/');
  const garden = await createGarden(request, 'E2E camera validation');
  const image = await syntheticPhoto(page, 1000, 750);
  async function save(points: ImagePoint[], calibrationPoints: ImagePoint[], focalLengthPx?: number) {
    const photo: GardenPhoto = { dataUrl: image.dataUrl, imageWidth: 1000, imageHeight: 750, corners: points, boundary: points,
      calibration: rectangleCalibration(calibrationPoints, 10, 8, focalLengthPx) };
    return await request.put(`${api}/gardens/${garden.id}`, { data: { ...garden, photo } });
  }
  const crossed = await save(corners, [corners[0], corners[2], corners[1], corners[3]]);
  expect(crossed.status()).toBe(400);
  expect((await crossed.json()).code).toBe('INVALID_CALIBRATION');
  const overhead = new PerspectiveCamera(50, 4 / 3, 0.01, 1000);
  overhead.position.set(0, 14, 0); overhead.up.set(0, 0, -1); overhead.lookAt(0, 0, 0); overhead.updateMatrixWorld(true);
  const points = [[-5, 0, 4], [5, 0, 4], [5, 0, -4], [-5, 0, -4]].map((p) => project(p, overhead));
  const ambiguous = await save(points, points);
  expect(ambiguous.status()).toBe(400);
  expect((await ambiguous.json()).code).toBe('INVALID_CALIBRATION');
  const manual = await save(points, points, 750 / (2 * Math.tan(50 * Math.PI / 360)));
  expect(manual.status(), await manual.text()).toBe(200);
  const result = (await manual.json() as GardenDocument).photo!.calibration!;
  expect(result.focalSource).toBe('manual'); expect(result.reprojectionErrorPx).toBeLessThan(0.01);
  expect(result.rotation).not.toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
});
