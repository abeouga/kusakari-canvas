import { selectTestPlant } from './catalog-fixture';
import { syntheticPhoto } from './occlusion-helpers';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { api } from './api-url.js';
import type { GardenDocument } from '../frontend/src/types/garden.js';

test('S. 作業面・独立開閉・ダイアログのフォーカス・未保存確認', async ({ page, request }) => {
  const created = await (await request.post(`${api}/gardens`, { data: { name: `E2E workspace ${Date.now()}` } })).json() as GardenDocument;
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/gardens/${created.id}`);
    await page.getByRole('button', { name: '3D庭', exact: true }).click();
    await expect(page.getByTestId('save-status')).toHaveText('保存済み');
    const canvas = page.locator('[data-testid="garden-canvas"] canvas');
    const initialBox = (await canvas.boundingBox())!;
    await page.getByRole('button', { name: '商品・買い物リストパネルを隠す', exact: true }).click();
    await expect(page.locator('#properties-panel')).toHaveCount(0);
    await expect.poll(async () => (await canvas.boundingBox())!.width).toBeGreaterThan(initialBox.width);
    await expect(page.getByTestId('object-toolbar')).toBeVisible();
    await page.getByRole('button', { name: '商品・買い物リストパネルを表示', exact: true }).click();
    await expect(page.locator('#properties-panel')).toBeVisible();
    await expect.poll(async () => (await canvas.boundingBox())!.width).toBe(initialBox.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true);

    await page.getByRole('button', { name: '上から見る' }).click();
    await selectTestPlant(page);
    const box = (await canvas.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 1 / 1');
    await page.keyboard.press('Escape');
    await expect(page.locator('.browse-actions button[aria-pressed="true"]')).toHaveCount(0);
    await expect(page.getByTestId('save-status')).toHaveText('保存済み');
    const saved = await (await request.get(`${api}/gardens/${created.id}`)).json() as GardenDocument;
    await page.reload();
    await page.getByRole('button', { name: '3D庭', exact: true }).click();
    await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 1 / 1');
    expect(await (await request.get(`${api}/gardens/${created.id}`)).json()).toEqual(saved);
    await mkdir(resolve('artifacts/e2e'), { recursive: true });
    await writeFile(resolve('artifacts/e2e/workspace-reloaded.json'), JSON.stringify(saved, null, 2));
    await page.screenshot({ path: resolve('artifacts/e2e/workspace-reloaded.png'), fullPage: true });

    const dimensions = page.getByRole('button', { name: '土台設定', exact: true });
    await dimensions.click();
    await expect(page.getByLabel('幅 (m)', { exact: true })).toBeFocused();
    await page.getByLabel('幅 (m)', { exact: true }).fill('11');
    // The browser focus trap must contain keyboard navigation in the modal.
    for (let i = 0; i < 9; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('dialog[open]'))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(dimensions).toBeFocused();
    await expect(page.getByTestId('save-status')).toHaveText('保存済み');

    if (!await page.locator('.object-details').evaluate((element) => (element as HTMLDetailsElement).open)) await page.getByTestId('object-details-toggle').click();
    await page.getByTestId('position-x').fill('1.7');
    const back = page.getByRole('button', { name: '← 庭一覧', exact: true });
    // Committed transforms flush automatically before navigation.
    await back.click();
    await page.waitForURL('/');
    const moved = await (await request.get(`${api}/gardens/${created.id}`)).json();
    expect(moved.objects[0].position.x).toBe(1.7);
    await page.goto(`/gardens/${created.id}`);
    await page.getByRole('button', { name: '3D庭', exact: true }).click();
    await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 1 / 1');
    // An unfinished photo boundary is the current unsaved navigation case.
    await page.getByRole('button', { name: '写真＋設計', exact: true }).click();
    const photo = await syntheticPhoto(page, 600, 400);
    await page.getByLabel('庭の写真を選択').setInputFiles({ name: 'draft.png', mimeType: 'image/png',
      buffer: Buffer.from(photo.dataUrl.split(',')[1], 'base64') });
    await expect(page.getByTestId('save-status')).toHaveText('輪郭を描画中');
    await back.click();
    await expect(page.getByRole('dialog', { name: '変更を保存せずに戻りますか？' })).toBeVisible();
    await expect(page.getByRole('button', { name: '編集を続ける' })).toBeFocused();
    await page.keyboard.press('Delete');
    await page.keyboard.press('Escape');
    await expect(back).toBeFocused();
    await expect(page.getByTestId('object-row-0')).toBeVisible();
    await expect(page.getByTestId('position-x')).toHaveValue('1.7');
    let unexpectedDialogs = 0;
    page.on('dialog', async (dialog) => { unexpectedDialogs++; await dialog.dismiss(); });
    await back.click();
    await page.getByRole('button', { name: '変更を破棄して戻る' }).click();
    await page.waitForURL('/');
    expect(unexpectedDialogs).toBe(0);
    expect(await (await request.get(`${api}/gardens/${created.id}`)).json()).toEqual(moved);

    const deletion = page.getByRole('button', { name: `${created.name}のオプション`, exact: true });
    await deletion.click();
    await page.getByRole('button', { name: '削除', exact: true }).click();
    await expect(page.getByRole('button', { name: '取消', exact: true })).toBeFocused();
    await page.screenshot({ path: resolve('artifacts/e2e/workspace-delete-dialog.png'), fullPage: true });
    await page.keyboard.press('Escape');
    await expect(deletion).toBeFocused();
    expect((await request.get(`${api}/gardens/${created.id}`)).status()).toBe(200);
    await page.screenshot({ path: resolve('artifacts/e2e/workspace-projects.png'), fullPage: true });
  } finally { expect((await request.delete(`${api}/gardens/${created.id}`)).status()).toBe(204); }
});
