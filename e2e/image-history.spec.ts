import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { api } from './api-url.js';
import { artifacts, createScene, openScene, readGarden, removeScenes, shrub, syntheticPhoto } from './occlusion-helpers.js';

async function fixture(page: Page, request: APIRequestContext, ids: string[]) {
  const photo = await syntheticPhoto(page, 600, 400);
  const garden = await createScene(request, ids, photo, [shrub(0, 0)]);
  const after = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 400;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#f03040';
    context.fillRect(0, 0, 600, 400);
    return canvas.toDataURL('image/png');
  });
  // Controlled storage fixtures are not represented as live model outputs.
  const payload = { id: randomUUID(), document: garden, beforeDataUrl: photo.dataUrl, afterDataUrl: after,
    model: 'gpt-image-2.5-sunburst', quality: 'medium', generationMethod: 'full_frame_v1', inputImageCount: 2,
    referenceSummary: [{ assetId: 'shrub_boxwood', productId: 'storage-fixture',
      productName: 'E2E storage fixture', source: 'uploaded' }] };
  return { garden, payload, url: `${api}/gardens/${garden.id}/image-history` };
}

test('real history API preserves bytes and snapshot, rejects conflicts and paginates after deletion', async ({ page, request }) => {
  const ids: string[] = [];
  try {
    const { garden, payload, url } = await fixture(page, request, ids);
    const saves = await Promise.all([request.post(url, { data: payload }), request.post(url, { data: payload })]);
    expect(saves.map((response) => response.status())).toEqual([200, 200]);
    const summary = await saves[0].json();
    expect(await saves[1].json()).toEqual(summary);
    expect(summary.createdAt).toMatch(/Z$/);
    expect(summary.generationMethod).toBe('full_frame_v1');
    expect((await request.post(url, { data: { ...payload, inputImageCount: 3 } })).status()).toBe(409);
    expect((await request.post(url, { data: { ...payload, generationMethod: 'masked_composite_v1' } })).status()).toBe(409);
    for (const generationMethod of ['unknown', null]) {
      expect((await request.post(url, { data: { ...payload, id: randomUUID(), generationMethod } })).status()).toBe(400);
    }
    const missingMethod: Record<string, unknown> = { ...payload, id: randomUUID() };
    delete missingMethod.generationMethod;
    expect((await request.post(url, { data: missingMethod })).status()).toBe(400);
    const detail = await (await request.get(`${url}/${payload.id}`)).json();
    expect(detail.beforeDataUrl).toBe(payload.beforeDataUrl);
    expect(detail.afterDataUrl).toBe(payload.afterDataUrl);
    expect(detail.document).toEqual(garden);
    expect(detail.generationMethod).toBe('full_frame_v1');
    const legacyPayload = { ...payload, id: randomUUID(), generationMethod: 'masked_composite_v1' };
    expect((await request.post(url, { data: legacyPayload })).status()).toBe(200);
    const legacyDetail = await (await request.get(`${url}/${legacyPayload.id}`)).json();
    expect(legacyDetail.generationMethod).toBe('masked_composite_v1');
    expect(legacyDetail.afterDataUrl).toBe(payload.afterDataUrl);
    expect((await request.post(url, { data: legacyPayload })).status()).toBe(200);
    expect((await request.delete(`${url}/${legacyPayload.id}`)).status()).toBe(204);
    const savedIds = [payload.id];
    for (let index = 0; index < 4; index++) {
      const id = randomUUID();
      expect((await request.post(url, { data: { ...payload, id } })).status()).toBe(200);
      savedIds.unshift(id);
    }
    const first = await (await request.get(`${url}?limit=2`)).json();
    expect(first.items.map((item: { id: string }) => item.id)).toEqual(savedIds.slice(0, 2));
    expect(first.items[0]).not.toHaveProperty('beforeDataUrl');
    expect(first.items[0]).not.toHaveProperty('document');
    expect(first.items.every((item: { generationMethod: string }) => item.generationMethod === 'full_frame_v1')).toBe(true);
    expect((await request.delete(`${url}/${first.items[1].id}`)).status()).toBe(204);
    const newId = randomUUID();
    expect((await request.post(url, { data: { ...payload, id: newId } })).status()).toBe(200);
    const next = await (await request.get(`${url}?limit=2&cursor=${encodeURIComponent(first.nextCursor)}`)).json();
    expect(next.items.map((item: { id: string }) => item.id)).toEqual(savedIds.slice(2, 4));
    const last = await (await request.get(`${url}?limit=2&cursor=${encodeURIComponent(next.nextCursor)}`)).json();
    expect(last.items.map((item: { id: string }) => item.id)).toEqual(savedIds.slice(4));
    expect(last.nextCursor).toBeNull();
    expect((await request.get(`${url}?cursor=invalid`)).status()).toBe(400);
    expect((await request.get(`${url}/invalid`)).status()).toBe(400);
    expect((await request.post(url, { data: { ...payload, id: randomUUID(), model: 'unknown' } })).status()).toBe(400);
    const other = await createScene(request, ids, garden.photo!, [shrub(0, 0)]);
    expect((await request.get(`${api}/gardens/${other.id}/image-history/${payload.id}`)).status()).toBe(404);
    expect((await request.delete(`${api}/gardens/${other.id}/image-history/${payload.id}`)).status()).toBe(404);
    const changed = await request.put(`${api}/gardens/${garden.id}`, { data: { ...garden, name: 'edited later', photo: null } });
    expect(changed.status()).toBe(200);
    expect((await (await request.get(`${url}/${payload.id}`)).json()).document).toEqual(garden);
    expect((await request.delete(`${api}/gardens/${garden.id}`)).status()).toBe(204);
    ids.splice(ids.indexOf(garden.id), 1);
    expect((await request.get(url)).status()).toBe(404);
  } finally { await removeScenes(request, ids); }
});

test('history reload, aligned slider, keyboard, pointer, narrow screen, download and delete confirmation', async ({ page, request }) => {
  const ids: string[] = [];
  try {
    const { garden, payload, url } = await fixture(page, request, ids);
    expect((await request.post(url, { data: payload })).status()).toBe(200);
    await openScene(page, garden);
    await page.reload();
    await page.getByTestId('completion-menu-toggle').click();
    await page.getByRole('button', { name: '生成履歴', exact: true }).click();
    const history = page.getByRole('dialog', { name: '生成履歴', exact: true });
    const row = page.getByTestId(`history-item-${payload.id}`);
    await row.getByRole('button', { name: '比較する', exact: true }).click();
    const before = page.getByTestId('comparison-before');
    const after = page.getByTestId('comparison-after');
    await expect(before).toBeVisible();
    await expect(after).toHaveAttribute('src', payload.afterDataUrl);
    expect(await before.boundingBox()).toEqual(await after.boundingBox());
    const range = page.getByRole('slider', { name: 'Before／Afterの比較位置', exact: true });
    await expect(range).toHaveValue('50');
    await range.focus();
    await page.keyboard.press('Home');
    await expect(range).toHaveValue('0');
    await page.keyboard.press('End');
    await expect(range).toHaveValue('100');
    await page.keyboard.press('ArrowLeft');
    await expect(range).toHaveValue('99');
    const frame = history.locator('.before-after-frame');
    const bounds = (await frame.boundingBox())!;
    await page.mouse.move(bounds.x + bounds.width * 0.25, bounds.y + bounds.height * 0.7);
    await page.mouse.down();
    await expect(range).toHaveValue('25');
    await page.mouse.move(bounds.x + bounds.width * 0.75, bounds.y + bounds.height * 0.7);
    await page.mouse.up();
    await expect(range).toHaveValue('75');
    await expect(before).toHaveCSS('clip-path', 'inset(0px 25% 0px 0px)');
    await mkdir(artifacts, { recursive: true });
    await frame.scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(artifacts, 'history-desktop-comparison.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await frame.scrollIntoViewIfNeeded();
    expect(await before.boundingBox()).toEqual(await after.boundingBox());
    const narrow = (await frame.boundingBox())!;
    expect(narrow.width).toBeLessThan(390);
    const touch = await page.context().newCDPSession(page);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [
      { x: narrow.x + narrow.width * 0.3, y: narrow.y + narrow.height * 0.7 },
    ] });
    await expect(range).toHaveValue('30');
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await touch.detach();
    await page.screenshot({ path: resolve(artifacts, 'history-mobile-comparison.png'), fullPage: true });
    for (const [label, source, filename] of [
      ['Before画像をPNGで保存', payload.beforeDataUrl, 'kusakari-before.png'],
      ['After画像をPNGで保存', payload.afterDataUrl, 'kusakari-after.png'],
    ]) {
      const pending = page.waitForEvent('download');
      await history.getByRole('link', { name: label, exact: true }).click();
      const download = await pending;
      expect(download.suggestedFilename()).toBe(filename);
      const target = resolve(artifacts, `history-${filename}`);
      await download.saveAs(target);
      expect(await readFile(target)).toEqual(Buffer.from(source.split(',')[1], 'base64'));
    }
    await history.getByRole('button', { name: 'この履歴を削除' }).click();
    await page.getByRole('dialog', { name: '生成履歴を削除', exact: true }).getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.getByTestId('comparison-after')).toBeVisible();
    await history.getByRole('button', { name: 'この履歴を削除' }).click();
    await page.getByRole('dialog', { name: '生成履歴を削除', exact: true }).getByRole('button', { name: '削除する', exact: true }).click();
    await expect(row).toHaveCount(0);
    await expect(history.getByText('保存された生成履歴はありません。')).toBeVisible();
    expect((await request.get(`${url}/${payload.id}`)).status()).toBe(404);
    expect(await readGarden(request, garden.id)).toEqual(garden);
    await writeFile(resolve(artifacts, 'history-garden.json'), JSON.stringify(garden, null, 2));
  } finally { await removeScenes(request, ids); }
});

test('mixed history keeps each method and image paired after switching, download and reload', async ({ page, request }) => {
  const ids: string[] = [];
  const directory = resolve(artifacts, 'full-frame-phase3');
  let generationRequests = 0;
  page.on('request', (outgoing) => {
    if (outgoing.method() === 'POST' && outgoing.url().endsWith('/ai-image')) generationRequests++;
  });
  try {
    const { garden, payload, url } = await fixture(page, request, ids);
    const legacy = { ...payload, id: randomUUID(), generationMethod: 'masked_composite_v1',
      afterDataUrl: payload.beforeDataUrl };
    expect((await request.post(url, { data: payload })).status()).toBe(200);
    expect((await request.post(url, { data: legacy })).status()).toBe(200);
    await mkdir(directory, { recursive: true });
    await openScene(page, garden);
    await page.getByTestId('completion-menu-toggle').click();
    await page.getByRole('button', { name: '生成履歴', exact: true }).click();
    const history = page.getByRole('dialog', { name: '生成履歴', exact: true });
    const method = history.getByTestId('generation-method-details');
    for (const item of [payload, legacy, payload]) {
      if (await history.getByRole('button', { name: '履歴一覧に戻る', exact: true }).isVisible()) await history.getByRole('button', { name: '履歴一覧に戻る', exact: true }).click();
      await page.getByTestId(`history-item-${item.id}`).getByRole('button', { name: '比較する', exact: true }).click();
      await expect(method).toHaveAttribute('data-generation-method', item.generationMethod);
      await history.locator('.ai-studio-details > summary').click();
      await expect(page.getByTestId('comparison-before')).toHaveAttribute('src', item.beforeDataUrl);
      await expect(page.getByTestId('comparison-after')).toHaveAttribute('src', item.afterDataUrl);
      if (item.generationMethod === 'full_frame_v1') {
        await expect(method).toContainText('AI生成画像を全体採用');
        await expect(method).toContainText('背景・家具の形をBeforeと比べて');
      } else {
        await expect(method).toContainText('旧方式：植物部分を合成');
        await expect(method).toContainText('編集範囲外を保持');
      }
    }
    await history.locator('.generation-history-detail').scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(directory, 'full-frame-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await history.getByRole('button', { name: '履歴一覧に戻る', exact: true }).click();
    await page.getByTestId(`history-item-${legacy.id}`).getByRole('button', { name: '比較する', exact: true }).click();
    await expect(method).toHaveAttribute('data-generation-method', legacy.generationMethod);
    await history.locator('.ai-studio-details > summary').click();
    await expect(page.getByTestId('comparison-after')).toHaveAttribute('src', legacy.afterDataUrl);
    await method.scrollIntoViewIfNeeded();
    const bounds = (await method.boundingBox())!;
    expect(bounds.width).toBeLessThan(390);
    await page.screenshot({ path: resolve(directory, 'legacy-mobile.png'), fullPage: true });
    const pending = page.waitForEvent('download');
    await history.getByRole('link', { name: 'After画像をPNGで保存', exact: true }).click();
    const download = await pending;
    const target = resolve(directory, 'legacy-after.png');
    await download.saveAs(target);
    expect(await readFile(target)).toEqual(Buffer.from(legacy.afterDataUrl.split(',')[1], 'base64'));
    await page.reload();
    await page.getByTestId('completion-menu-toggle').click();
    await page.getByRole('button', { name: '生成履歴', exact: true }).click();
    await page.getByTestId(`history-item-${legacy.id}`).getByRole('button', { name: '比較する', exact: true }).click();
    await expect(method).toContainText('旧方式：植物部分を合成');
    await history.locator('.ai-studio-details > summary').click();
    await expect(page.getByTestId('comparison-after')).toHaveAttribute('src', legacy.afterDataUrl);
    expect(await readGarden(request, garden.id)).toEqual(garden);
    expect(generationRequests).toBe(0);
    await method.scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(directory, 'legacy-reloaded.png'), fullPage: true });
    await writeFile(resolve(directory, 'garden-reloaded.json'), JSON.stringify(garden, null, 2));
    await writeFile(resolve(directory, 'metrics.json'), JSON.stringify({
      generationRequests, methodSwitches: 3, legacyDownloadedBytesMatch: true,
      reloaded: true, snapshotUnchanged: true, controlledStorageFixtures: true,
    }, null, 2));
  } finally { await removeScenes(request, ids); }
});

test('real API retries a failed history transport and keeps other entries after deletion', async ({ page, request }) => {
  const ids: string[] = [];
  try {
    const { garden, payload, url } = await fixture(page, request, ids);
    expect((await request.post(url, { data: payload })).status()).toBe(200);
    const secondId = randomUUID();
    expect((await request.post(url, { data: { ...payload, id: secondId } })).status()).toBe(200);
    await openScene(page, garden);
    await page.route('**/image-history?*', (route) => route.abort(), { times: 1 });
    await page.getByTestId('completion-menu-toggle').click();
    await page.getByRole('button', { name: '生成履歴', exact: true }).click();
    await page.getByRole('button', { name: '履歴を再取得', exact: true }).click();
    const row = page.getByTestId(`history-item-${payload.id}`);
    await expect(row).toBeVisible();
    await page.route(`**/image-history/${payload.id}`, (route) => route.abort(), { times: 1 });
    await row.getByRole('button', { name: '比較する', exact: true }).click();
    await page.getByRole('button', { name: '比較画像を再取得', exact: true }).click();
    await expect(page.getByTestId('comparison-before')).toBeVisible();
    await page.getByRole('dialog', { name: '生成履歴', exact: true }).getByRole('button', { name: 'この履歴を削除' }).click();
    await page.route(`**/image-history/${payload.id}`, (route) => route.abort(), { times: 1 });
    const confirmation = page.getByRole('dialog', { name: '生成履歴を削除', exact: true });
    await confirmation.getByRole('button', { name: '削除する', exact: true }).click();
    await expect(confirmation.getByRole('alert')).toBeVisible();
    await expect(page.getByTestId('comparison-after')).toBeVisible();
    await confirmation.getByRole('button', { name: '削除する', exact: true }).click();
    await expect(row).toHaveCount(0);
    await expect(page.getByTestId(`history-item-${secondId}`)).toBeVisible();
    expect((await request.get(`${url}/${secondId}`)).status()).toBe(200);
  } finally { await removeScenes(request, ids); }
});

test('history loads another page and compares an old snapshot after the current photo is removed', async ({ page, request }) => {
  const ids: string[] = [];
  try {
    const { garden, payload, url } = await fixture(page, request, ids);
    for (let index = 0; index < 22; index++) {
      expect((await request.post(url, { data: { ...payload, id: randomUUID() } })).status()).toBe(200);
    }
    const updated = await request.put(`${api}/gardens/${garden.id}`, { data: { ...garden, photo: null } });
    expect(updated.status()).toBe(200);
    const current = await readGarden(request, garden.id);
    await page.goto(`/gardens/${garden.id}`);
    await page.getByTestId('completion-menu-toggle').click();
    await page.getByRole('button', { name: '生成履歴', exact: true }).click();
    const entries = page.locator('[data-testid^="history-item-"]');
    await expect(entries).toHaveCount(20);
    await page.getByRole('button', { name: 'さらに読み込む', exact: true }).click();
    await expect(entries).toHaveCount(22);
    await expect(page.getByRole('button', { name: 'さらに読み込む', exact: true })).toHaveCount(0);
    await entries.last().getByRole('button', { name: '比較する', exact: true }).click();
    await expect(page.getByTestId('comparison-before')).toHaveAttribute('src', payload.beforeDataUrl);
    expect(await readGarden(request, garden.id)).toEqual(current);
    await mkdir(artifacts, { recursive: true });
    await page.reload();
    await page.getByTestId('completion-menu-toggle').click();
    await page.getByRole('button', { name: '生成履歴', exact: true }).click();
    await expect(entries).toHaveCount(20);
    await entries.first().getByRole('button', { name: '比較する', exact: true }).click();
    await expect(page.getByTestId('comparison-before')).toBeVisible();
    await page.screenshot({ path: resolve(artifacts, 'history-without-current-photo-reloaded.png'), fullPage: true });
    await writeFile(resolve(artifacts, 'history-without-current-photo-garden.json'), JSON.stringify(current, null, 2));
  } finally { await removeScenes(request, ids); }
});

test('history accepts an opaque After larger than 8MB and rejects mismatched or transparent images', async ({ page, request }) => {
  const ids: string[] = [];
  try {
    const photo = await syntheticPhoto(page, 2048, 1792);
    const garden = await createScene(request, ids, photo, [shrub(0, 0)]);
    const afterDataUrl = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 2048;
      canvas.height = 1792;
      const context = canvas.getContext('2d')!;
      const pixels = context.createImageData(canvas.width, canvas.height);
      let state = 0x12345678;
      for (let index = 0; index < pixels.data.length; index += 4) {
        for (let channel = 0; channel < 3; channel++) {
          state ^= state << 13;
          state ^= state >>> 17;
          state ^= state << 5;
          pixels.data[index + channel] = state & 255;
        }
        pixels.data[index + 3] = 255;
      }
      context.putImageData(pixels, 0, 0);
      return canvas.toDataURL('image/png');
    });
    const pngBytes = Buffer.from(afterDataUrl.split(',')[1], 'base64').length;
    expect(pngBytes).toBeGreaterThan(8_000_000);
    expect(pngBytes).toBeLessThan(20_000_000);
    const payload = { id: randomUUID(), document: garden, beforeDataUrl: photo.dataUrl, afterDataUrl,
      model: 'gpt-image-2.5-sunburst', quality: 'medium', generationMethod: 'full_frame_v1', inputImageCount: 2,
      referenceSummary: [{ assetId: 'shrub_boxwood', productId: 'large-storage-fixture',
        productName: 'E2E high entropy storage fixture', source: 'uploaded' }] };
    const url = `${api}/gardens/${garden.id}/image-history`;
    const saved = await request.post(url, { data: payload });
    expect(saved.status()).toBe(200);
    const detail = await (await request.get(`${url}/${payload.id}`)).json();
    expect(detail.afterDataUrl).toBe(afterDataUrl);
    const invalid = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 2;
      canvas.height = 2;
      const transparent = canvas.toDataURL('image/png');
      const context = canvas.getContext('2d')!;
      context.fillRect(0, 0, 2, 2);
      return { transparent, opaque: canvas.toDataURL('image/png') };
    });
    for (const value of [invalid.transparent, invalid.opaque]) {
      expect((await request.post(url, { data: { ...payload, id: randomUUID(), afterDataUrl: value } })).status()).toBe(400);
    }
    await mkdir(artifacts, { recursive: true });
    await writeFile(resolve(artifacts, 'history-large-after-metrics.json'), JSON.stringify({ pngBytes, exactBytesPreserved: true }, null, 2));
  } finally { await removeScenes(request, ids); }
});
