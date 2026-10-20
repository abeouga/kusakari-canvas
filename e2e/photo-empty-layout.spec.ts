import { expect, test } from '@playwright/test';
import { api } from './api-url.js';

test('写真アップロード枠が左右の余白を保ち、クリックで写真を選択できる', async ({ page, request }, testInfo) => {
  const response = await request.post(`${api}/gardens`, { data: { name: `E2E photo layout ${Date.now()}` } });
  expect(response.ok()).toBeTruthy();
  const garden = await response.json();
  await page.goto(`/gardens/${garden.id}`);
  await expect(page.getByTestId('save-status')).toHaveText('保存済み');
  await expect(page.getByRole('button', { name: '写真＋設計', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const upload = page.locator('button.photo-empty');
  for (const width of [1440, 1280, 768, 390]) {
    await page.setViewportSize({ width, height: 960 });
    await expect(upload).toBeVisible();
    const workspace = (await page.locator('.photo-workspace').boundingBox())!;
    const button = (await upload.boundingBox())!;
    const left = button.x - workspace.x;
    const right = workspace.x + workspace.width - button.x - button.width;
    expect(left).toBeGreaterThanOrEqual(28);
    expect(right).toBeGreaterThanOrEqual(28);
    expect(Math.abs(left - right)).toBeLessThan(1);
  }
  await page.setViewportSize({ width: 1280, height: 960 });
  await page.reload();
  await expect(page.getByRole('button', { name: '写真＋設計', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(upload).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('photo-empty-reloaded.png'), fullPage: true });
  const saved = await request.get(`${api}/gardens/${garden.id}`);
  expect(saved.ok()).toBeTruthy();
  await testInfo.attach('garden-reloaded.json', { body: await saved.body(), contentType: 'application/json' });
  const chooser = page.waitForEvent('filechooser');
  await upload.click();
  const fileChooser = await chooser;
  expect(fileChooser.isMultiple()).toBe(false);
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 800; canvas.height = 600;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#708e91'; context.fillRect(0, 0, 800, 600);
    context.fillStyle = '#647744'; context.fillRect(0, 300, 800, 300);
    return canvas.toDataURL('image/png');
  });
  await fileChooser.setFiles({ name: 'garden-layout.png', mimeType: 'image/png', buffer: Buffer.from(dataUrl.split(',')[1], 'base64') });
  await expect(page.locator('.photo-stage image')).toBeVisible();
  await expect(upload).toHaveCount(0);
  // Upload starts a boundary draft; autosave waits until the user closes it.
  for (const [x, y] of [[80, 520], [720, 520], [640, 300], [160, 300]]) {
    const point = await page.locator('.photo-stage').evaluate((element, coordinates) => {
      const screen = new DOMPoint(coordinates.x, coordinates.y).matrixTransform((element as SVGSVGElement).getScreenCTM()!);
      return { x: screen.x, y: screen.y };
    }, { x, y });
    await page.mouse.click(point.x, point.y);
  }
  await page.getByRole('button', { name: '始点につないで輪郭を確定' }).click();
  await expect(page.getByTestId('photo-ground')).toBeVisible();
  await expect(page.getByTestId('save-status')).toHaveText('保存済み');
  await expect.poll(async () => {
    const snapshot = await (await request.get(`${api}/gardens/${garden.id}`)).json();
    return snapshot.photo?.dataUrl;
  }).toBe(dataUrl);
  await page.reload();
  await expect(page.getByRole('button', { name: '写真＋設計', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.photo-stage image')).toBeVisible();
  await expect(page.locator('.photo-stage image')).toHaveAttribute('href', dataUrl);
  await page.screenshot({ path: testInfo.outputPath('photo-upload-reloaded.png'), fullPage: true });
  const uploaded = await request.get(`${api}/gardens/${garden.id}`);
  expect(uploaded.ok()).toBeTruthy();
  await testInfo.attach('garden-upload-reloaded.json', { body: await uploaded.body(), contentType: 'application/json' });
});
