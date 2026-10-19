import { selectTestPlant } from './catalog-fixture';
import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { api } from './api-url.js';

test('editor controls preserve state and the merged canvas toolbar fits narrow screens', async ({ page, request }) => {
  const garden = await (await request.post(`${api}/gardens`, { data: { name: `E2E toolbar ${Date.now()}` } })).json();
  try {
    await page.goto(`/gardens/${garden.id}`);
    await expect(page.getByTestId('save-status')).toHaveText('保存済み');
    await expect(page.locator('.document-bar')).toHaveCount(0);
    const bar = page.locator('.canvas-tools');
    await expect(bar.locator('.toolbar-status')).toHaveCount(0);
    await expect(page.getByTestId('save-garden')).toHaveCount(0);
    await expect(bar.locator('.document-identity').getByRole('button')).toHaveCount(1);
    await expect(page.locator('.editor-shell > .plan-actions')).toHaveCount(0);
    for (const width of [1440, 1280, 1100, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 960 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const modes = await page.getByRole('group', { name: '表示モード' }).boundingBox();
      const surface = await page.locator('.canvas-column').boundingBox();
      if (surface!.width > 900) expect(Math.abs(modes!.x + modes!.width / 2 - surface!.x - surface!.width / 2)).toBeLessThan(2);
      const bounds = await bar.boundingBox();
      for (const button of await bar.getByRole('button').all()) {
        const item = await button.boundingBox();
        expect(item!.x).toBeGreaterThanOrEqual(bounds!.x);
        expect(item!.x + item!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width + 1);
      }
      if (width >= 1280) expect(bounds!.height).toBeLessThanOrEqual(70);
    }
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.getByTestId('object-details-toggle').click();
    if (!await page.locator('.construction-details').evaluate((element) => (element as HTMLDetailsElement).open)) await page.locator('.construction-details > summary').click();
    await expect(page.locator('.construction-details')).toContainText('配置したものはありません');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('object-details-toggle')).toBeFocused();
    await expect(page.getByRole('button', { name: '植物候補を相談', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '上から見る', exact: true }).click();
    await selectTestPlant(page);
    const canvas = await page.locator('[data-testid="garden-canvas"] canvas').boundingBox();
    await page.mouse.click(canvas!.x + canvas!.width / 2, canvas!.y + canvas!.height / 2);
    await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 1 / 1');
    await page.keyboard.press('Escape');
    await page.getByTestId('object-details-toggle').click();
    if (!await page.locator('.construction-details').evaluate((element) => (element as HTMLDetailsElement).open)) await page.locator('.construction-details > summary').click();
    await expect(page.locator('.construction-details')).toContainText('1点');
    await expect(page.locator('.construction-details input')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.getByTestId('object-row-0').click();
    await page.getByTestId('object-details-toggle').click();
    await page.getByRole('button', { name: '複製', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(bar.getByRole('button', { name: '買い物リストをECで確認', exact: true })).toHaveCount(0);
    await expect(bar.getByTestId('save-status')).toHaveText('保存済み');
    await page.reload();
    await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 2 / 2');
    const saved = await (await request.get(`${api}/gardens/${garden.id}`)).json();
    expect(saved.objects).toHaveLength(2);
    await mkdir('artifacts/e2e', { recursive: true });
    await writeFile('artifacts/e2e/editor-toolbar-reloaded.json', JSON.stringify(saved, null, 2));
    await page.screenshot({ path: 'artifacts/e2e/editor-toolbar-reloaded.png' });
    if (!await page.getByRole('button', { name: '完成イメージを確認', exact: true }).isVisible()) await page.getByRole('button', { name: /^(AI生成|完成イメージ)メニュー$/ }).click();

    await page.getByRole('button', { name: '完成イメージを確認', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '庭の完成イメージ' }).locator('img')).toBeVisible();
    await page.keyboard.press('Escape');
    // The real destination/cart roundtrip is covered by the EC integration suite.
    const navigation = page.waitForRequest((request) => request.isNavigationRequest() && request.url() === ((process.env.KUSAKARI_EC_E2E_WEB_URL || 'http://127.0.0.1:15186') + '/'));
    await expect(page.getByRole('button', { name: 'ECへ戻る', exact: true })).toHaveCount(0);
    await page.getByRole('link', { name: 'Kusakari トップへ', exact: true }).click();
    expect((await navigation).isNavigationRequest()).toBe(true);
  } finally {
    expect((await request.delete(`${api}/gardens/${garden.id}`)).status()).toBe(204);
  }
});
