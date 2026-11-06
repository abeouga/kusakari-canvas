import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createGardenFromList } from './garden-create.js';
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

async function uploadPhotoAndCancelOutline(page: Page) {
  const imageDataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 800; canvas.height = 600;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#647744'; context.fillRect(0, 0, 800, 600);
    return canvas.toDataURL('image/png');
  });
  await page.getByLabel('庭の写真を選択').setInputFiles({ name: 'garden.png', mimeType: 'image/png',
    buffer: Buffer.from(imageDataUrl.split(',')[1], 'base64') });
  await expect(page.getByTestId('save-status')).toHaveText('輪郭を描画中');
  await page.getByRole('button', { name: '輪郭の描画を取消' }).click();
  await expect(page.locator('.photo-stage image')).toBeVisible();
}

// Issue #21: 輪郭を描かずに描画を取消した写真は保存できないため、確認後に保存せず庭一覧へ戻る。
test('施工範囲が未確定の写真は確認後に保存せず庭一覧へ戻る', async ({ page, request }) => {
  const id = await createGardenFromList(page);
  createdGardenIds.push(id);
  await expect(page.getByTestId('save-status')).toHaveText('保存済み');
  const before = await (await request.get(`${api}/gardens/${id}`)).json();
  expect(before.photo ?? null).toBeNull();
  await uploadPhotoAndCancelOutline(page);

  const back = page.getByRole('button', { name: '← 庭一覧', exact: true });
  const dialog = page.getByRole('dialog', { name: '庭写真を保存せずに戻りますか？' });
  await back.click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('この庭写真は保存されません');
  await expect(page.locator('.editor-alert.notice-error')).toHaveCount(0);
  await mkdir(artifactDirectory, { recursive: true });
  await page.screenshot({ path: resolve(artifactDirectory, 'photo-unconfirmed-leave-dialog.png') });
  await page.getByRole('button', { name: '編集を続ける' }).click();
  await expect(dialog).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe(`/gardens/${id}`);
  await expect(page.locator('.photo-stage image')).toBeVisible();

  // 共通ヘッダーからの移動も同じ確認を通る。
  await page.locator('.kusakari-site-header').getByRole('link', { name: 'Canvas', exact: true }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  let unexpectedDialogs = 0;
  page.on('dialog', async (native) => { unexpectedDialogs++; await native.dismiss(); });
  await back.click();
  await page.getByRole('button', { name: '写真を保存せず戻る' }).click();
  await page.waitForURL('/');
  expect(unexpectedDialogs).toBe(0);
  const after = await (await request.get(`${api}/gardens/${id}`)).json();
  expect(after).toEqual(before);
  await writeFile(resolve(artifactDirectory, 'photo-unconfirmed-leave-garden.json'), `${JSON.stringify(after, null, 2)}\n`, 'utf8');
  await page.reload();
  await expect(page.getByRole('heading', { name: '保存した庭', exact: true })).toBeVisible();
  await page.screenshot({ path: resolve(artifactDirectory, 'photo-unconfirmed-leave-list.png'), fullPage: true });
});
