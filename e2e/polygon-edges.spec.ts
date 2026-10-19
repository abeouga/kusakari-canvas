import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { api } from './api-url.js';
import type { GardenDocument } from '../frontend/src/types/garden.js';

const directory = resolve('artifacts/e2e');
const boundary = [{ x: .2, y: .8 }, { x: .8, y: .8 }, { x: .8, y: .5 }, { x: .55, y: .5 }, { x: .55, y: .2 }, { x: .2, y: .2 }];
const lengths = [10, 4, 25 / 6, 4, 35 / 6, 8];

for (const fixedProjection of [false, true]) {
  const mode = fixedProjection ? 'fixed-projection' : 'legacy';
  test('R. 6辺の計測・閉じ辺・輪郭固定・保存復元 (' + mode + ')', async ({ page, request }) => {
    await mkdir(directory, { recursive: true });
    const initial = await (await request.post(api + '/gardens', { data: { name: 'E2E edge measurement ' + mode + ' ' + Date.now() } })).json() as GardenDocument;
    try {
      await page.goto('/gardens/' + initial.id);
      const dataUrl = await page.evaluate(() => {
        const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 750;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#a3af93'; ctx.fillRect(0, 0, 1000, 750);
        ctx.fillStyle = '#d9d6c8'; ctx.fillRect(500, 80, 350, 250);
        ctx.fillStyle = '#68765b'; ctx.fillRect(60, 70, 100, 610);
        ctx.fillStyle = '#e6e1d2'; ctx.font = '22px sans-serif'; ctx.fillText('POLYGON / SYNTHETIC IMAGE', 200, 80);
        return canvas.toDataURL('image/png');
      });
      const photo = { dataUrl, imageWidth: 1000, imageHeight: 750, boundary,
        corners: [{ x: .2, y: .8 }, { x: .8, y: .8 }, { x: .8, y: .2 }, { x: .2, y: .2 }],
        ...(fixedProjection ? { projectionSize: { width: 10, depth: 8 } } : {}) };
      const response = await request.put(api + '/gardens/' + initial.id, {
        data: { ...initial, width: fixedProjection ? 14 : 10, depth: fixedProjection ? 12 : 8, photo },
      });
      expect(response.status()).toBe(200);
      const saved = await response.json() as GardenDocument;
      await page.reload();
      await expect(page.getByTestId('photo-edge-5')).toBeVisible();
      const outline = await page.getByTestId('photo-ground').getAttribute('points');
      const vertices = await page.locator('[data-testid^="photo-vertex-"]').evaluateAll((elements) =>
        elements.map((element) => [element.getAttribute('cx'), element.getAttribute('cy')]));
      const popup = page.getByRole('dialog', { name: '選択した辺の長さ' });
      for (const [index, length] of lengths.entries()) {
        const edge = page.getByTestId('photo-edge-' + index);
        if (index % 2 === 0) await edge.click();
        else { await edge.focus(); await page.keyboard.press(index === 5 ? 'Space' : 'Enter'); }
        await expect(popup).toBeVisible();
        await expect(page.getByTestId('edge-measurement')).toHaveText(length.toFixed(2) + ' m');
        await expect(popup).toContainText('現在の概算');
        await expect(popup.getByLabel('辺の長さ（m）')).toBeFocused();
        await expect(popup.getByRole('button', { name: '長さを適用' })).toBeEnabled();
        await expect(page.getByTestId('photo-ground')).toHaveAttribute('points', outline!);
        await expect(page.getByTestId('save-status')).toHaveText('保存済み');
        await expect(page.getByTestId('save-garden')).toHaveCount(0);
        if (index % 2 === 0) await page.keyboard.press('Escape');
        else await popup.getByRole('button', { name: '辺の計測を閉じる' }).click();
        await expect(edge).toBeFocused();
      }
      expect(await page.locator('[data-testid^="photo-vertex-"]').evaluateAll((elements) =>
        elements.map((element) => [element.getAttribute('cx'), element.getAttribute('cy')]))).toEqual(vertices);
      expect(await (await request.get(api + '/gardens/' + initial.id)).json()).toEqual(saved);
      await page.getByTestId('photo-edge-4').click();
      await page.screenshot({ path: resolve(directory, 'polygon-edge-measurement-' + mode + '.png'), fullPage: true });
      await page.setViewportSize({ width: 1024, height: 768 });
      await expect.poll(async () => {
        const box = (await popup.boundingBox())!, stage = (await page.locator('.photo-stage-shell').boundingBox())!;
        return box.x >= stage.x && box.y >= stage.y && box.x + box.width <= stage.x + stage.width && box.y + box.height <= stage.y + stage.height;
      }).toBe(true);
      await page.screenshot({ path: resolve(directory, 'edge-measurement-1024-' + mode + '.png'), fullPage: true });
      await popup.getByRole('button', { name: '取消', exact: true }).click();
      await expect(page.getByTestId('photo-edge-4')).toBeFocused();
      const camera = page.getByRole('button', { name: '写真のカメラを設定' });
      await camera.click();
      await page.getByLabel('基準の幅（m）').fill('3');
      await page.keyboard.press('Escape');
      await expect(camera).toBeFocused();
      await expect(page.getByTestId('photo-ground')).toHaveAttribute('points', outline!);
      await expect(page.getByTestId('save-status')).toHaveText('保存済み');
      await page.setViewportSize({ width: 1440, height: 960 });
      await page.getByRole('button', { name: '3D庭', exact: true }).click();
      await expect(page.getByTestId('garden-canvas')).toBeVisible();
      await page.getByRole('button', { name: '写真＋設計', exact: true }).click();
      await expect(page.getByTestId('photo-ground')).toHaveAttribute('points', outline!);
      await page.reload();
      await page.getByTestId('photo-edge-5').click();
      await expect(page.getByTestId('edge-measurement')).toHaveText('8.00 m');
      await expect(page.getByTestId('photo-ground')).toHaveAttribute('points', outline!);
      expect(await (await request.get(api + '/gardens/' + initial.id)).json()).toEqual(saved);
      await page.screenshot({ path: resolve(directory, 'edge-measurement-reloaded-' + mode + '.png'), fullPage: true });
      await writeFile(resolve(directory, 'edge-measurement-' + mode + '.json'), JSON.stringify(saved, null, 2));
    } finally { expect((await request.delete(api + '/gardens/' + initial.id)).status()).toBe(204); }
  });
}
