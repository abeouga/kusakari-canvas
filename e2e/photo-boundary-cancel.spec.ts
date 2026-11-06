import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createGardenFromList } from './garden-create';
import { expect, test, type Page } from './test.js';
import { api } from './api-url.js';

const artifactDirectory = resolve('artifacts/e2e');
let createdGardenIds: string[] = [];

test.beforeEach(() => { createdGardenIds = []; });
test.afterEach(async ({ request }) => {
  for (const id of createdGardenIds) {
    expect([204, 404]).toContain((await request.delete(`${api}/gardens/${id}`)).status());
  }
});

async function clickImage(page: Page, x: number, y: number) {
  const point = await page.locator('.photo-stage').evaluate((element, coords) => {
    const screen = new DOMPoint(coords.x * 800, coords.y * 600).matrixTransform((element as SVGSVGElement).getScreenCTM()!);
    return { x: screen.x, y: screen.y };
  }, { x, y });
  await page.mouse.click(point.x, point.y);
}

// Issue #22: 写真アップロード直後に輪郭の描画を取消してから3Dを開くと、空の輪郭で地面を作り画面全体が描画されなくなっていた。
test('写真アップロード後に輪郭の描画を取消すと3D庭は輪郭確定まで開けず、確定後は3D庭を表示して保存復元する', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const id = await createGardenFromList(page);
  createdGardenIds.push(id);
  await expect(page.getByTestId('save-status')).toHaveText('保存済み');
  const imageDataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 800; canvas.height = 600;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#708e91'; context.fillRect(0, 0, 800, 600);
    context.fillStyle = '#647744'; context.fillRect(80, 160, 640, 400);
    return canvas.toDataURL('image/png');
  });
  await page.getByLabel('庭の写真を選択').setInputFiles({ name: 'garden.png', mimeType: 'image/png', buffer: Buffer.from(imageDataUrl.split(',')[1], 'base64') });
  await expect(page.locator('.photo-stage image')).toBeVisible();
  await expect(page.getByTestId('save-status')).toHaveText('輪郭を描画中');

  await page.getByRole('button', { name: '輪郭の描画を取消' }).click();
  const threeD = page.getByRole('button', { name: '3D庭', exact: true });
  await expect(threeD).toBeDisabled();
  await expect(threeD).toHaveAttribute('title', '庭の輪郭を確定すると3D庭を表示できます');
  await expect(page.locator('.photo-progress')).toHaveText('写真上の庭の輪郭と実寸範囲が確定すると自動保存され、3D庭を表示できます。');
  await expect(page.locator('.photo-stage image')).toBeVisible();
  expect(errors).toEqual([]);
  await mkdir(artifactDirectory, { recursive: true });
  await page.screenshot({ path: resolve(artifactDirectory, 'photo-boundary-cancelled.png'), fullPage: true });

  await page.getByRole('button', { name: '庭の領域を描く' }).click();
  for (const [x, y] of [[0.1, 0.9], [0.9, 0.9], [0.8, 0.3], [0.2, 0.3]]) await clickImage(page, x, y);
  await page.getByRole('button', { name: '始点につないで輪郭を確定' }).click();
  await expect(page.getByTestId('photo-ground')).toBeVisible();
  await expect(page.getByTestId('save-status')).toHaveText('保存済み');
  await expect(threeD).toBeEnabled();
  await threeD.click();
  await expect(threeD).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('garden-canvas').locator('canvas')).toBeVisible();

  await page.reload();
  await expect(page.getByTestId('save-status')).toHaveText('保存済み');
  await threeD.click();
  await expect(page.getByTestId('garden-canvas').locator('canvas')).toBeVisible();
  expect(errors).toEqual([]);
  await page.screenshot({ path: resolve(artifactDirectory, 'photo-boundary-cancel-3d.png'), fullPage: true });
  const response = await request.get(`${api}/gardens/${id}`);
  expect(response.ok()).toBeTruthy();
  const saved = await response.json();
  expect(saved.photo?.boundary).toHaveLength(4);
  await writeFile(resolve(artifactDirectory, 'photo-boundary-cancel-3d.json'), `${JSON.stringify(saved, null, 2)}\n`, 'utf8');
});
