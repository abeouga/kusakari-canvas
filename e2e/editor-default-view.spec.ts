import { randomUUID } from 'node:crypto';
import { expect, test, type Page, type TestInfo } from './test.js';
import { api } from './api-url';
import { readGarden } from './occlusion-helpers';

async function expectPhoto(page: Page) {
  await expect(page.getByRole('button', { name: '写真＋設計', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '3D庭', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('button.photo-empty')).toBeVisible();
}

async function evidence(page: Page, id: string, testInfo: TestInfo, name: string) {
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
  const garden = await readGarden(page.request, id);
  await testInfo.attach(`${name}.json`, { body: JSON.stringify(garden, null, 2), contentType: 'application/json' });
  return garden;
}

test('新規・既存の庭は写真から開き、手動3D選択は保存中だけ維持する', async ({ page }, testInfo) => {
  const name = `E2E initial photo ${randomUUID()}`;
  await page.goto('/');
  await page.getByLabel('庭の名前').fill(name);
  await page.getByRole('button', { name: '庭を作成', exact: true }).click();
  await page.waitForURL(/\/gardens\//);
  const id = new URL(page.url()).pathname.split('/').at(-1)!;
  await expectPhoto(page);
  const initial = await readGarden(page.request, id);
  const writes: string[] = [];
  page.on('request', request => {
    if (request.method() === 'PUT' && request.url().endsWith(`/api/gardens/${id}`)) writes.push(request.url());
  });

  await page.getByRole('button', { name: '3D庭', exact: true }).click();
  await expect(page.getByTestId('garden-canvas')).toBeVisible();
  await page.getByRole('button', { name: '写真＋設計', exact: true }).click();
  await expectPhoto(page);
  expect(await readGarden(page.request, id)).toEqual(initial);
  expect(writes).toEqual([]);

  // A real edit and its save response must not reset the user's current 3D view.
  await page.getByRole('button', { name: '3D庭', exact: true }).click();
  await page.getByRole('button', { name: '土台設定', exact: true }).click();
  await page.getByLabel('幅 (m)', { exact: true }).fill('12');
  await page.getByRole('button', { name: '土台に適用', exact: true }).click();
  await expect.poll(async () => (await readGarden(page.request, id)).width).toBe(12);
  await expect(page.getByTestId('save-status')).toHaveText('保存済み');
  await expect(page.getByRole('button', { name: '3D庭', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '土台設定を閉じる', exact: true }).click();
  const saved = await readGarden(page.request, id);
  const thumbnailUrl = `${api}/gardens/${id}/thumbnail`;
  await expect.poll(async () => (await page.request.get(thumbnailUrl)).headers()['x-thumbnail-source']).toBe('scene');
  const thumbnail = await (await page.request.get(thumbnailUrl)).body();

  await page.reload();
  await expectPhoto(page);
  expect(await evidence(page, id, testInfo, 'reloaded-photo')).toEqual(saved);
  expect(await (await page.request.get(thumbnailUrl)).body()).toEqual(thumbnail);

  await page.getByRole('button', { name: '← 庭一覧', exact: true }).click();
  await page.locator('.garden-card').filter({ hasText: name }).locator('.garden-card-open').click();
  await expectPhoto(page);
  await page.goto(`/gardens/${id}`);
  await expectPhoto(page);
  expect(await evidence(page, id, testInfo, 'reopened-photo')).toEqual(saved);
});
