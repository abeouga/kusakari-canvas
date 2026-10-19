import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { api } from './api-url.js';

test('garden options duplicate and delete with persisted independent data', async ({ page, request }) => {
  const name = `E2E options ${Date.now()}`;
  const source = await (await request.post(`${api}/gardens`, { data: { name } })).json();
  let copyId = '';
  try {
    await page.goto(`/gardens/${source.id}`);
    await page.getByRole('button', { name: '上から見る', exact: true }).click();
    await page.getByTestId('asset-tree_oak').click();
    const box = await page.locator('[data-testid="garden-canvas"] canvas').boundingBox();
    if (!box) throw new Error('Canvasが表示されません。');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 1 / 1');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('save-status')).toHaveText('保存済み');
    const saved = await (await request.get(`${api}/gardens/${source.id}`)).json();
    await page.getByRole('button', { name: '← 庭一覧', exact: true }).click();
    const card = page.locator('.garden-card').filter({ has: page.getByText(name, { exact: true }) });
    const options = card.getByRole('button', { name: `${name}のオプション`, exact: true });
    await expect(card.getByRole('button', { name: '複製', exact: true })).toHaveCount(0);
    await expect(card.getByRole('button', { name: '削除', exact: true })).toHaveCount(0);
    await options.click();
    await expect(options).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(options).toBeFocused();
    await expect(options).toHaveAttribute('aria-expanded', 'false');
    await options.click();
    await page.getByRole('heading', { name: '保存した庭', exact: true }).click();
    await expect(options).toHaveAttribute('aria-expanded', 'false');
    await options.click();
    const response = page.waitForResponse((entry) => entry.url().endsWith('/api/gardens') && entry.request().method() === 'POST');
    await card.getByRole('button', { name: '複製', exact: true }).click();
    copyId = (await (await response).json()).id;
    const copyCard = page.locator('.garden-card').filter({ has: page.getByText(`${name}（複製）`, { exact: true }) });
    await expect(copyCard).toBeVisible();
    const copy = await (await request.get(`${api}/gardens/${copyId}`)).json();
    expect(copy.id).not.toBe(source.id);
    expect(copy.objects).toHaveLength(saved.objects.length);
    expect(copy.objects[0].id).not.toBe(saved.objects[0].id);
    expect({ ...copy.objects[0], id: saved.objects[0].id }).toEqual(saved.objects[0]);
    expect(await (await request.get(`${api}/gardens/${source.id}`)).json()).toEqual(saved);
    await page.reload();
    await expect(copyCard).toBeVisible();
    await mkdir('artifacts/e2e', { recursive: true });
    await writeFile('artifacts/e2e/garden-options-copy.json', JSON.stringify({ source: saved, copy }, null, 2));
    const copyOptions = copyCard.getByRole('button', { name: `${name}（複製）のオプション`, exact: true });
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 960 });
      await copyOptions.click();
      const panel = copyCard.getByRole('group');
      await expect(panel).toBeVisible();
      const bounds = await panel.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      await page.screenshot({ path: `artifacts/e2e/garden-options-${width}.png`, fullPage: true });
      await page.keyboard.press('Escape');
    }
    await copyOptions.click();
    await copyCard.getByRole('button', { name: '削除', exact: true }).click();
    await expect(page.getByRole('button', { name: '取消', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(copyOptions).toBeFocused();
    expect((await request.get(`${api}/gardens/${copyId}`)).status()).toBe(200);
    await copyOptions.click();
    await copyCard.getByRole('button', { name: '削除', exact: true }).click();
    await page.getByRole('button', { name: '庭を削除', exact: true }).click();
    await expect(copyCard).toHaveCount(0);
    expect((await request.get(`${api}/gardens/${copyId}`)).status()).toBe(404);
    expect(await (await request.get(`${api}/gardens/${source.id}`)).json()).toEqual(saved);
  } finally {
    for (const id of [copyId, source.id]) {
      if (id) expect([204, 404]).toContain((await request.delete(`${api}/gardens/${id}`)).status());
    }
  }
});
