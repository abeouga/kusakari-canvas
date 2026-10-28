import { selectTestPlant } from './catalog-fixture';
import { expect, test } from './test.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { api } from './api-url.js';

test('garden options duplicate and delete with persisted independent data', async ({ page, request }) => {
  const name = `E2E options ${Date.now()}`;
  const source = await (await request.post(`${api}/gardens`, { data: { name } })).json();
  let copyId = '';
  try {
    await page.goto(`/gardens/${source.id}`);
    await page.getByRole('button', { name: '3D庭', exact: true }).click();
    await page.getByRole('button', { name: '上から見る', exact: true }).click();
    await selectTestPlant(page);
    const box = await page.locator('[data-testid="garden-canvas"] canvas').boundingBox();
    if (!box) throw new Error('Canvasが表示されません。');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 1 / 1');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('save-status')).toHaveText('保存済み');
    const placed = await (await request.get(`${api}/gardens/${source.id}`)).json();
    await page.getByRole('button', { name: '← 庭一覧', exact: true }).click();
    // 複製対象に写真・輪郭を含めるため、配置済みの庭へ写真を保存する。
    const dataUrl = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#8fa178'; context.fillRect(0, 0, 640, 480);
      context.fillStyle = '#d8d2bf'; context.fillRect(80, 60, 200, 120);
      return canvas.toDataURL('image/png');
    });
    const square = [{ x: .2, y: .8 }, { x: .8, y: .8 }, { x: .8, y: .2 }, { x: .2, y: .2 }];
    const withPhoto = await request.put(`${api}/gardens/${source.id}`, { data: { ...placed,
      photo: { dataUrl, imageWidth: 640, imageHeight: 480, corners: square, boundary: square } } });
    expect(withPhoto.status()).toBe(200);
    const saved = await withPhoto.json();
    await page.reload();
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
    const copyCard = page.locator('.garden-card').filter({ has: page.getByText(`${name}（複製）`, { exact: true }) });
    const copyNames = async () => (await (await request.get(`${api}/gardens`)).json() as { name: string }[])
      .filter((garden) => garden.name === `${name}（複製）`);
    // 障害注入: 複製要求の通信を遮断する。エラーと再試行を示し、複製は1件も作られない。
    await page.route('**/api/gardens/*/duplicate', (route) => route.abort('failed'));
    await options.click();
    await card.getByRole('button', { name: '複製', exact: true }).click();
    const copyError = page.getByTestId('copy-error');
    await expect(copyError).toContainText('庭を複製できませんでした');
    await expect(copyCard).toHaveCount(0);
    expect(await copyNames()).toHaveLength(0);
    await page.unroute('**/api/gardens/*/duplicate');
    const requests: string[] = [];
    page.on('request', (entry) => {
      const path = new URL(entry.url()).pathname;
      if (path.startsWith('/api/gardens') && !path.endsWith('/thumbnail') && entry.method() !== 'GET') requests.push(`${entry.method()} ${path}`);
    });
    const response = page.waitForResponse((entry) => entry.url().endsWith(`/api/gardens/${source.id}/duplicate`) && entry.request().method() === 'POST');
    await copyError.getByRole('button', { name: '複製を再試行', exact: true }).click();
    const duplicated = await response;
    expect(duplicated.status()).toBe(201);
    copyId = (await duplicated.json()).id;
    await expect(copyCard).toBeVisible();
    await expect(copyError).toHaveCount(0);
    expect(requests).toEqual([`POST /api/gardens/${source.id}/duplicate`]);
    expect(await copyNames()).toHaveLength(1);
    const copy = await (await request.get(`${api}/gardens/${copyId}`)).json();
    expect(copy.id).not.toBe(source.id);
    expect(copy.name).toBe(`${name}（複製）`);
    expect([copy.width, copy.depth]).toEqual([saved.width, saved.depth]);
    expect(copy.photo).toEqual(saved.photo);
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

test('duplicate API keeps the 54-character name rule and creates nothing for an unknown garden', async ({ request }) => {
  const name = `E2E 複製名 ${Date.now()} `.padEnd(60, 'あ');
  const source = await (await request.post(`${api}/gardens`, { data: { name } })).json();
  const ids: string[] = [source.id];
  try {
    const before = (await (await request.get(`${api}/gardens`)).json() as unknown[]).length;
    expect((await request.post(`${api}/gardens/${randomUUID()}/duplicate`)).status()).toBe(404);
    expect((await (await request.get(`${api}/gardens`)).json() as unknown[]).length).toBe(before);
    const response = await request.post(`${api}/gardens/${source.id}/duplicate`);
    expect(response.status()).toBe(201);
    const copy = await response.json();
    ids.push(copy.id);
    expect(copy.name).toBe(name.slice(0, 54) + '（複製）');
    expect(copy.revision).toBe(0);
    expect((await (await request.get(`${api}/gardens`)).json() as unknown[]).length).toBe(before + 1);
  } finally {
    for (const id of ids) expect([204, 404]).toContain((await request.delete(`${api}/gardens/${id}`)).status());
  }
});
