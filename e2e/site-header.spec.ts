import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from './test.js';
import { api } from './api-url.js';

test('共通ヘッダー・ECへの移動確認・未保存の変更保護', async ({ page, request }) => {
  const response = await request.post(`${api}/gardens`, { data: { name: `E2E header ${Date.now()}` } });
  expect(response.ok()).toBe(true);
  const garden = await response.json();
  try {
    await page.goto(`/gardens/${garden.id}`);
    await expect(page.getByTestId('save-status')).toHaveText('保存済み');
    const header = page.locator('.kusakari-site-header');
    await expect(header.locator('.kusakari-feature-name')).toHaveCount(0);
    await expect(header.getByRole('link', { name: 'Canvas', exact: true })).toBeVisible();
    await expect(header.getByRole('link', { name: '出店者', exact: true })).toHaveCount(0);
    await expect(header.getByRole('link', { name: 'アカウント', exact: true })).toHaveCount(0);
    await expect(header.getByRole('link', { name: '注文履歴' })).toHaveAttribute('href', /\?panel=orders$/);
    await expect(header.getByRole('link', { name: 'ログイン', exact: true })).toHaveAttribute('href', /\?panel=login$/);
    await expect(header.getByRole('link', { name: /^カートを開く/ })).toHaveAttribute('href', /\/cart$/);
    await expect(header.locator('.bag-text')).toHaveText('カート');
    await expect(page.locator('.announcement')).toContainText('ひと鉢からはじまる、緑のある暮らし。');

    const panel = page.locator('.commerce-panel');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.side-panel-controls')).toHaveCount(0);
    await expect(panel).not.toContainText('受取店舗：');
    await expect(panel).not.toContainText('庭に素材を配置すると、対応する商品候補を表示します。');
    await page.getByRole('button', { name: '商品・買い物リストパネルを隠す', exact: true }).click();
    await expect(panel).toHaveCount(0);
    await page.getByRole('button', { name: '商品・買い物リストパネルを表示', exact: true }).click();
    await expect(panel).toBeVisible();

    await page.getByRole('button', { name: '3D庭', exact: true }).click();
    await page.getByRole('button', { name: '土台設定', exact: true }).click();
    await page.getByLabel('幅 (m)', { exact: true }).fill('11');
    await page.getByRole('button', { name: '土台に適用', exact: true }).click();
    await page.getByRole('button', { name: '土台設定を閉じる', exact: true }).click();
    await header.getByRole('link', { name: /^カートを開く/ }).click();
    await expect(page).toHaveURL(/\/cart$/);
    await page.goto(`/gardens/${garden.id}`);
    await expect(page.getByTestId('save-status')).toHaveText('保存済み');
    await page.reload();
    await expect(page.getByTestId('save-status')).toHaveText('保存済み');
    const saved = await (await request.get(`${api}/gardens/${garden.id}`)).json();
    expect(saved.width).toBe(11);
    await mkdir('artifacts/e2e', { recursive: true });
    await writeFile('artifacts/e2e/site-header-garden.json', JSON.stringify(saved, null, 2));
    await page.screenshot({ path: 'artifacts/e2e/site-header-editor-e2e.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(header.getByRole('link', { name: /^カートを開く/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: 'artifacts/e2e/site-header-mobile-e2e.png', fullPage: true });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '保存した庭', exact: true })).toBeVisible();
    await expect(page.getByText('庭のワークスペース', { exact: true })).toHaveCount(0);
    await expect(page.getByText('マイガーデン', { exact: true })).toHaveCount(0);
    await expect(page.getByText('写真と3Dで、庭の形や植栽の配置を編集します。', { exact: true })).toHaveCount(0);
    await expect(page.locator('.page-footer')).toHaveText(`kusakari ${new Date().getFullYear()}`);
    for (const width of [320, 390, 768, 1280, 1600]) {
      await page.setViewportSize({ width, height: 960 });
      const layout = await page.locator('.page-shell').boundingBox();
      const headerBox = await header.boundingBox();
      expect(layout!.width).toBeLessThanOrEqual(1360);
      expect(Math.abs(layout!.x + layout!.width / 2 - headerBox!.x - headerBox!.width / 2)).toBeLessThan(1);
      expect(await page.locator('.page-footer').evaluate((element) => getComputedStyle(element).justifyContent)).toBe('center');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.screenshot({ path: 'artifacts/e2e/site-header-list-e2e.png', fullPage: true });
  } finally {
    await request.delete(`${api}/gardens/${garden.id}`);
  }
});
