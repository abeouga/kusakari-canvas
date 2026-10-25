import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from './test.js';
import { api } from './api-url.js';
import { verifyFixedInputs } from './ai-quality-fixed-inputs.js';
import { qualityPhoto, type QualityPayload } from './ai-quality-helpers.js';
import { createTestProduct, productPlacement } from './catalog-fixture';
import { artifacts, capture, createScene, openScene, readGarden, removeScenes, shrub, syntheticPhoto } from './occlusion-helpers.js';

const artifactPrefix = process.env.KUSAKARI_CANVAS_AI_SETTINGS_RUN ?? 'quality-settings';
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(artifactPrefix)) throw new Error('Invalid settings run name.');

for (const quality of ['medium', 'high']) {
  test(`history preserves ${quality} quality through repeated saves and browser reload`, async ({ page, request }) => {
    const ids: string[] = [];
    let generationRequests = 0;
    page.on('request', (outgoing) => {
      if (outgoing.method() === 'POST' && outgoing.url().endsWith('/ai-image')) generationRequests++;
    });
    try {
      const status = await request.get(`${api}/ai/status`);
      expect(status.status()).toBe(200);
      expect(await status.json()).toEqual({ configured: false, model: 'gpt-image-2.5-sunburst',
        quality: process.env.KUSAKARI_CANVAS_AI_EVAL_QUALITY ?? 'medium' });
      const photo = await syntheticPhoto(page, 600, 400);
      const garden = await createScene(request, ids, photo, [shrub(0, 0)]);
      // Explicit storage fixture: no model output or normal API response is mocked.
      const payload = { id: randomUUID(), document: garden, beforeDataUrl: photo.dataUrl,
        afterDataUrl: photo.dataUrl, model: 'gpt-image-2.5-sunburst', quality,
        generationMethod: 'full_frame_v1', inputImageCount: 2,
        referenceSummary: [{ assetId: 'shrub_boxwood', productId: 'quality-storage-fixture',
          productName: '品質保持の履歴用テスト画像', source: 'uploaded' }] };
      const url = `${api}/gardens/${garden.id}/image-history`;
      const first = await request.post(url, { data: payload });
      expect(first.status()).toBe(200);
      const summary = await first.json();
      expect(summary.quality).toBe(quality);
      const repeated = await request.post(url, { data: payload });
      expect(repeated.status()).toBe(200);
      expect(await repeated.json()).toEqual(summary);
      const otherQuality = quality === 'medium' ? 'high' : 'medium';
      expect((await request.post(url, { data: { ...payload, quality: otherQuality } })).status()).toBe(409);
      for (const unsupported of ['low', 'unknown', null]) {
        expect((await request.post(url, { data: { ...payload, id: randomUUID(), quality: unsupported } })).status()).toBe(400);
      }
      await openScene(page, garden);
      await page.reload();
      await page.getByTestId('completion-menu-toggle').click();
      await page.getByRole('button', { name: '生成履歴', exact: true }).click();
      await page.getByTestId(`history-item-${payload.id}`).getByRole('button', { name: '比較する', exact: true }).click();
      await expect(page.getByRole('region', { name: '選択した生成履歴' })).toContainText(`品質：${quality}`);
      await expect(page.getByTestId('comparison-after')).toHaveAttribute('src', payload.afterDataUrl);
      const detail = await (await request.get(`${url}/${payload.id}`)).json();
      expect(detail.quality).toBe(quality);
      expect(detail.beforeDataUrl).toBe(payload.beforeDataUrl);
      expect(detail.afterDataUrl).toBe(payload.afterDataUrl);
      expect(detail.document).toEqual(garden);
      expect(await readGarden(request, garden.id)).toEqual(garden);
      expect(generationRequests).toBe(0);
      const serverQuality = process.env.KUSAKARI_CANVAS_AI_EVAL_QUALITY ?? 'medium';
      await mkdir(artifacts, { recursive: true });
      const name = `${artifactPrefix}-${serverQuality}-history-${quality}`;
      await writeFile(resolve(artifacts, `${name}.json`), JSON.stringify({ garden, summary,
        generationRequests, repeatedSaveUnchanged: true, imageBytesUnchanged: true }, null, 2));
      await page.screenshot({ path: resolve(artifacts, `${name}-reloaded.png`), fullPage: true });
    } finally { await removeScenes(request, ids); }
  });
}

test('fixed-input guard accepts the actual browser capture before a real no-key API refusal', async ({ page, request }) => {
  // Full-resolution capture plus reload exceeded the synthetic-fixture 90-second budget.
  test.setTimeout(180_000);
  const ids: string[] = [];
  try {
    const baseline = `fixed-input-${randomUUID()}`;
    const directory = resolve('artifacts/e2e/ai-quality', baseline, 'single');
    await mkdir(directory, { recursive: true });
    const photo = await qualityPhoto(page);
    const product = await createTestProduct(request, '品質固定入力');
    const garden = await createScene(request, ids, photo, [productPlacement(product)]);
    await openScene(page, garden);
    const image = await capture(page);
    await page.getByRole('group', { name: '品質固定入力の参考写真' }).getByLabel('写真を選択').setInputFiles({
      name: 'reference.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(photo.dataUrl.split(',')[1], 'base64'),
    });
    await expect(page.getByAltText('品質固定入力の選択した参考写真')).toBeVisible();
    const firstResponse = page.waitForResponse(r => r.url().endsWith('/ai-image') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'AIで生成（API利用料が発生します）', exact: true }).click();
    const first = await firstResponse;
    expect(first.status()).toBe(503);
    const frozen = first.request().postDataJSON() as QualityPayload;
    await writeFile(resolve(directory, 'snapshot.json'), JSON.stringify(garden));
    await writeFile(resolve(directory, 'before.png'), Buffer.from(frozen.beforeDataUrl.split(',')[1], 'base64'));
    await writeFile(resolve(directory, 'coverage.png'), Buffer.from(frozen.coverageDataUrl.split(',')[1], 'base64'));
    await writeFile(resolve(directory, 'reference.jpg'), Buffer.from(frozen.references[0].photoDataUrl.split(',')[1], 'base64'));
    await writeFile(resolve(directory, 'request.json'), JSON.stringify({ ...frozen, inputOrder: [
      { kind: 'uploaded-reference', assetId: frozen.references[0].assetId, productId: product.id, file: 'reference.jpg' },
    ] }));
    const changed = structuredClone(frozen);
    changed.document.width += 1;
    await expect(verifyFixedInputs(changed, 'single', baseline)).rejects.toThrow();
    let matched = false;
    await page.route('**/ai-image', async (route) => {
      try {
        await verifyFixedInputs(route.request().postDataJSON() as QualityPayload, 'single', baseline);
        matched = true;
      } catch (error) {
        await route.abort('blockedbyclient');
        throw error;
      }
      await route.continue();
    });
    const pending = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/ai-image'));
    await page.getByRole('button', { name: 'AIで生成（API利用料が発生します）', exact: true }).click();
    const response = await pending;
    expect(response.status()).toBe(503);
    expect((await response.json()).code).toBe('AI_NOT_CONFIGURED');
    expect(matched).toBe(true);
    expect(image.before).toBe(response.request().postDataJSON().beforeDataUrl);
    await page.keyboard.press('Escape');
    await page.reload();
    expect(await readGarden(request, garden.id)).toEqual(garden);
    const serverQuality = process.env.KUSAKARI_CANVAS_AI_EVAL_QUALITY ?? 'medium';
    await page.screenshot({ path: resolve(artifacts, `${artifactPrefix}-${serverQuality}-fixed-inputs-reloaded.png`), fullPage: true });
    await writeFile(resolve(artifacts, `${artifactPrefix}-${serverQuality}-fixed-inputs.json`), JSON.stringify({ garden,
      fixedInputsMatch: true, changedInputRejected: true, apiAttempts: 2, providerRequests: 0 }, null, 2));
  } finally { await removeScenes(request, ids); }
});
