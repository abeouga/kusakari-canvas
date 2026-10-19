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
    await expect(page.getByTestId('save-status')).toHaveText('保存済み');
    const canvas = page.locator('[data-testid="garden-canvas"] canvas');
    const initialBox = (await canvas.boundingBox())!;
    await page.getByRole('button', { name: 'オブジェクトパネルを隠す', exact: true }).click();
    await expect(page.getByTestId('asset-tree_oak')).toBeHidden();
    await expect(page.locator('#properties-panel')).toBeVisible();
    await expect.poll(async () => (await canvas.boundingBox())!.height).toBeGreaterThan(initialBox.height);
    await page.getByRole('button', { name: '商品・カートパネルを隠す', exact: true }).click();
    await expect(page.locator('#properties-panel')).toHaveCount(0);
    await expect.poll(async () => (await canvas.boundingBox())!.width).toBeGreaterThan(initialBox.width);
    await page.getByRole('button', { name: 'オブジェクトパネルを表示', exact: true }).click();
    await expect(page.getByTestId('asset-tree_oak')).toBeVisible();
    await expect(page.locator('#properties-panel')).toHaveCount(0);
    await page.getByRole('button', { name: '商品・カートパネルを表示', exact: true }).click();
    await expect(page.locator('#properties-panel')).toBeVisible();
    await expect.poll(async () => (await canvas.boundingBox())!.width).toBe(initialBox.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true);

    await page.getByRole('button', { name: '上から見る' }).click();
    await page.getByTestId('asset-tree_oak').click();
    const box = (await canvas.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 1 / 1');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('asset-tree_oak')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('save-status')).toHaveText('保存済み');
    const saved = await (await request.get(`${api}/gardens/${created.id}`)).json() as GardenDocument;
    await page.reload();
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
    expect(await (await request.get(`${api}/gardens/${created.id}`)).json()).toEqual(saved);

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
