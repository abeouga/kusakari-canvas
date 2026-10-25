import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from './test.js';
import { api } from './api-url.js';
import { artifacts, capture, createScene, openScene, readGarden, removeScenes, shrub, syntheticPhoto } from './occlusion-helpers.js';

test('live OpenAI edit returns a full-frame result after a real EC product selection', async ({ page, request }) => {
  test.skip(process.env.KUSAKARI_CANVAS_AI_LIVE !== '1', 'Only an explicitly enabled paid live run may call OpenAI.');
  test.setTimeout(260_000);
  const ids: string[] = [];
  let generationRequests = 0;
  page.on('request', (outgoing) => {
    if (outgoing.method() === 'POST' && outgoing.url().endsWith('/ai-image')) generationRequests++;
  });
  try {
    const status = await (await request.get(`${api}/ai/status`)).json();
    expect(status.configured).toBe(true);
    const photo = await syntheticPhoto(page, 1201, 801);
    const plant = shrub(0.3, -1.8, 1.2);
    const bench = { ...shrub(0, 1, 2), assetId: 'bench_wood' };
    const garden = await createScene(request, ids, photo, [plant, bench]);
    await openScene(page, garden);
    const before = await capture(page);
    await page.getByRole('combobox', { name: '低木に対応する商品', exact: true }).selectOption('canvas-boxwood');
    const reference = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 256;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#f1e8d8';
      context.fillRect(0, 0, 256, 256);
      context.fillStyle = '#6b4830';
      context.fillRect(122, 160, 12, 65);
      for (let row = 0; row < 7; row++) {
        for (let column = 0; column < 7; column++) {
          const x = 68 + column * 20;
          const y = 50 + row * 20;
          if (Math.hypot(x - 128, y - 110) > 82) continue;
          context.fillStyle = (row + column) % 2 === 0 ? '#437939' : '#62964d';
          context.beginPath();
          context.ellipse(x, y, 19, 13, 0.3, 0, Math.PI * 2);
          context.fill();
        }
      }
      return canvas.toDataURL('image/png');
    });
    await page.getByLabel('低木の参考写真を追加・選び直す', { exact: true }).setInputFiles({
      name: 'synthetic-boxwood-reference.png', mimeType: 'image/png', buffer: Buffer.from(reference.split(',')[1], 'base64') });
    await expect(page.getByAltText('低木の選択した参考写真')).toBeVisible();
    const pending = page.waitForRequest((outgoing) => outgoing.method() === 'POST' && outgoing.url().endsWith('/ai-image'));
    const start = Date.now();
    await page.getByRole('button', { name: 'AIで生成（API利用料が発生します）', exact: true }).click();
    const outgoing = await pending;
    const payload = outgoing.postDataJSON();
    await expect(page.getByRole('button', { name: 'AI画像を生成中…', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: '庭の完成イメージ' })).toBeVisible();
    const response = await outgoing.response();
    const data = await response!.json();
    await mkdir(artifacts, { recursive: true });
    if (!response!.ok()) {
      await writeFile(resolve(artifacts, 'ai-live-error.json'), JSON.stringify({ status: response!.status(),
        code: data.code, message: data.message, elapsedMs: Date.now() - start }, null, 2));
      await page.screenshot({ path: resolve(artifacts, 'ai-live-error.png'), fullPage: true });
    }
    expect(response!.status(), `${data.code ?? ''}: ${data.message ?? ''}`).toBe(200);
    await expect(page.getByTestId('after-image')).toBeVisible();
    expect([data.width, data.height]).toEqual(await page.getByTestId('comparison-after')
      .evaluate((image: HTMLImageElement) => [image.naturalWidth, image.naturalHeight]));
    expect(data.model).toBe('gpt-image-2.5-sunburst');
    expect(data.historySaved).toBe(true);
    expect(data.generationMethod).toBe('full_frame_v3');
    expect(data.historyId).toBe(payload.generationId);
    const historyUrl = `${api}/gardens/${garden.id}/image-history`;
    const historyList = await (await request.get(historyUrl)).json();
    expect(historyList.items.map((item: { id: string }) => item.id)).toEqual([data.historyId]);
    const saved = await (await request.get(`${historyUrl}/${data.historyId}`)).json();
    expect(saved.beforeDataUrl).toBe(before.before);
    expect(saved.afterDataUrl).toBe(data.dataUrl);
    expect(saved.document).toEqual(payload.document);
    expect(saved.generationMethod).toBe(data.generationMethod);
    const duplicate = await request.post(`${api}/gardens/${garden.id}/ai-image`, { data: payload });
    expect(duplicate.status()).toBe(409);
    expect((await duplicate.json()).code).toBe('HISTORY_ALREADY_EXISTS');
    expect(data.inputImageCount).toBe(2);
    expect(generationRequests).toBe(1);
    const metrics = await page.evaluate(async ({ before, after, coverage }) => {
      async function pixels(source: string, size?: { width: number; height: number }) {
        const image = new Image();
        image.src = source;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = size?.width ?? image.naturalWidth;
        canvas.height = size?.height ?? image.naturalHeight;
        const context = canvas.getContext('2d')!;
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        return { width: canvas.width, height: canvas.height,
          data: context.getImageData(0, 0, canvas.width, canvas.height).data };
      }
      const original = await pixels(before);
      // Resample only this diagnostic view, never the saved generated image.
      const result = await pixels(after, original);
      const signal = await pixels(coverage);
      let changed = 0;
      let protectedChanges = 0;
      let furnitureChanges = 0;
      let transparent = 0;
      for (let y = 0; y < original.height; y++) {
        for (let x = 0; x < original.width; x++) {
          const index = (y * original.width + x) * 4;
          if (result.data[index + 3] !== 255) transparent++;
          let different = false;
          for (let channel = 0; channel < 4; channel++) {
            if (original.data[index + channel] !== result.data[index + channel]) different = true;
          }
          if (!different) continue;
          changed++;
          if (signal.data[index + 1] > 2) furnitureChanges++;
          let nearPlant = false;
          for (let row = Math.max(0, y - 8); row <= Math.min(original.height - 1, y + 8); row++) {
            for (let column = Math.max(0, x - 8); column <= Math.min(original.width - 1, x + 8); column++) {
              if (signal.data[(row * original.width + column) * 4] > 2) {
                nearPlant = true;
                break;
              }
            }
            if (nearPlant) break;
          }
          if (!nearPlant) protectedChanges++;
        }
      }
      return { width: result.width, height: result.height, changed, protectedChanges, furnitureChanges, transparent };
    }, { before: before.before, after: data.dataUrl, coverage: payload.coverageDataUrl });
    expect(metrics.changed).toBeGreaterThan(100);
    // Background/furniture differences are diagnostics, not a pixel-lock guarantee.
    expect(metrics.transparent).toBe(0);
    expect(await readGarden(request, garden.id)).toEqual(garden);
    const downloadPending = page.waitForEvent('download');
    await page.getByRole('link', { name: 'After画像をPNGで保存', exact: true }).click();
    const download = await downloadPending;
    expect(download.suggestedFilename()).toBe('kusakari-after.png');
    await download.saveAs(resolve(artifacts, 'ai-live-after.png'));
    await writeFile(resolve(artifacts, 'ai-live-before.png'), Buffer.from(before.before.split(',')[1], 'base64'));
    await writeFile(resolve(artifacts, 'ai-live-coverage.png'), Buffer.from(payload.coverageDataUrl.split(',')[1], 'base64'));
    await writeFile(resolve(artifacts, 'ai-live-metrics.json'), JSON.stringify({ ...metrics,
      elapsedMs: Date.now() - start, generationRequests, inputImageCount: data.inputImageCount,
      model: data.model, quality: data.quality, referenceSummary: data.referenceSummary,
      historySaved: data.historySaved, historyId: data.historyId, duplicateRejectedBeforeProvider: true }, null, 2));
    await page.screenshot({ path: resolve(artifacts, 'ai-live-result.png'), fullPage: true });
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 2 / 2');
    expect(await readGarden(request, garden.id)).toEqual(garden);
    await page.getByTestId('completion-menu-toggle').click();
    await page.getByRole('button', { name: '生成履歴', exact: true }).click();
    await page.getByTestId(`history-item-${data.historyId}`).getByRole('button', { name: '比較する' }).click();
    await expect(page.getByTestId('comparison-after')).toHaveAttribute('src', data.dataUrl);
    await expect(page.getByTestId('comparison-before')).toHaveAttribute('src', before.before);
    await writeFile(resolve(artifacts, 'ai-live-reloaded-garden.json'), JSON.stringify(garden, null, 2));
    await page.screenshot({ path: resolve(artifacts, 'ai-live-reloaded.png'), fullPage: true });
  } finally { await removeScenes(request, ids); }
});
