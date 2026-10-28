import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from './test.js';
import { api } from './api-url.js';
import { verifyProviderEvidence } from './ai-quality-evidence.js';
import { verifyFixedInputs } from './ai-quality-fixed-inputs.js';
import { capture, createScene, openScene, readGarden, removeScenes } from './occlusion-helpers.js';
import { downloadImage, imageBytes, measureOutput, placementAssumption, qualityObjects,
  qualityPhoto, saveCapture, saveJson, saveRequest, uploadReferences,
  type QualityCase, type QualityPayload } from './ai-quality-helpers.js';

const cases: QualityCase[] = ['single', 'multiple', 'overlap'];
const qualityLive = process.env.KUSAKARI_CANVAS_AI_QUALITY_LIVE === '1' && process.env.KUSAKARI_CANVAS_AI_LIVE === '1';
let runMode = 'capture';
if (qualityLive) runMode = 'live';
const defaultRun = `${new Date().toISOString().replace(/[:.]/g, '-')}-${runMode}`;
const runName = process.env.KUSAKARI_CANVAS_AI_QUALITY_RUN ?? defaultRun;
const baselineRun = process.env.KUSAKARI_CANVAS_AI_QUALITY_BASELINE;
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(runName)) {
  throw new Error('KUSAKARI_CANVAS_AI_QUALITY_RUNは101文字以内の英数字・ピリオド・ハイフン・アンダースコアで指定してください。');
}
if (baselineRun && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(baselineRun)) {
  throw new Error('品質比較の基線はai-quality内の実行フォルダー名で指定してください。');
}

for (const name of cases) {
  test(`AI quality ${name}: real-photo capture and optional paid generation`, async ({ page, request }) => {
    const wantsLive = process.env.KUSAKARI_CANVAS_AI_QUALITY_LIVE === '1';
    const live = wantsLive && process.env.KUSAKARI_CANVAS_AI_LIVE === '1';
    // This evaluation has one UI generation per case, with no automatic retry.
    if (live) test.setTimeout(260_000);
    const ids: string[] = [];
    const directory = resolve('artifacts/e2e/ai-quality', runName, name);
    await mkdir(resolve('artifacts/e2e/ai-quality', runName), { recursive: true });
    await mkdir(directory);
    let generationRequests = 0;
    page.on('request', (outgoing) => {
      if (outgoing.method() === 'POST' && outgoing.url().endsWith('/ai-image')) generationRequests++;
    });
    const start = Date.now();
    try {
      expect(!wantsLive || live, 'Paid quality evaluation requires both KUSAKARI_CANVAS_AI_QUALITY_LIVE=1 and KUSAKARI_CANVAS_AI_LIVE=1.').toBe(true);
      if (live) expect(process.env.KUSAKARI_CANVAS_AI_EVIDENCE_DIR).toBeTruthy();
      const photo = await qualityPhoto(page);
      let objects = qualityObjects(name);
      if (baselineRun) {
        const path = resolve('artifacts/e2e/ai-quality', baselineRun, name, 'snapshot.json');
        const baseline = JSON.parse(await readFile(path, 'utf8'));
        expect(baseline.photo).toEqual(photo);
        objects = baseline.objects;
      }
      const garden = await createScene(request, ids, photo, objects);
      await openScene(page, garden);
      const captured = await capture(page);
      await saveCapture(directory, garden, captured);
      if (baselineRun) {
        const path = resolve('artifacts/e2e/ai-quality', baselineRun, name, 'before.png');
        expect(imageBytes(captured.before).equals(await readFile(path)), '比較前のBefore画像は基線と同一です。').toBe(true);
      }
      await page.screenshot({ path: resolve(directory, 'captured.png'), fullPage: true });
      const metrics = { run: runName, baselineRun: baselineRun ?? null, case: name, live, placementAssumption,
        photoWidth: photo.imageWidth, photoHeight: photo.imageHeight,
        visualQualityAssessment: '未評価。Before／Afterの目視レビューが別途必要です。',
      };
      await saveJson(directory, 'metrics.json', { ...metrics, phase: 'captured', generationRequests });
      expect(await readGarden(request, garden.id)).toEqual(garden);
      if (!live) {
        await saveJson(directory, 'request.json', { submitted: false, placementAssumption,
          reason: '撮影のみ。API送信を行わないためcoverageと実際のAPI入力順は未取得です。',
          coverage: null, after: null, generationRequests,
        });
        await page.keyboard.press('Escape');
        await page.reload();
        await expect(page.getByTestId('model-loaded')).toHaveText(`読み込み済み: ${garden.objects.length} / ${garden.objects.length}`);
        const reloaded = await readGarden(request, garden.id);
        expect(reloaded).toEqual(garden);
        await saveJson(directory, 'snapshot-reloaded.json', reloaded);
        await page.screenshot({ path: resolve(directory, 'reloaded.png'), fullPage: true });
        expect(generationRequests).toBe(0);
        await saveJson(directory, 'metrics.json', { ...metrics, phase: 'capture-only-complete',
          generationRequests, snapshotUnchanged: true, reloaded: true, coverageCaptured: false,
          elapsedMs: Date.now() - start,
        });
        return;
      }
      const statusResponse = await request.get(`${api}/ai/status`);
      expect(statusResponse.status()).toBe(200);
      const status = await statusResponse.json();
      expect(status.configured).toBe(true);
      expect(status.quality).toBe(process.env.KUSAKARI_CANVAS_AI_EVAL_QUALITY ?? 'medium');
      await uploadReferences(page, garden);
      if (baselineRun && process.env.KUSAKARI_CANVAS_AI_EVAL_QUALITY) {
        await page.route('**/ai-image', async (route) => {
          try {
            await verifyFixedInputs(route.request().postDataJSON() as QualityPayload, name, baselineRun);
            await saveJson(directory, 'preflight.json', { fixedBrowserInputsMatch: true, submitted: false });
          } catch (error) {
            await saveJson(directory, 'preflight.json', { fixedBrowserInputsMatch: false, submitted: false });
            await route.abort('blockedbyclient');
            throw error;
          }
          // This is a pass-through guard, not a mocked success response.
          await route.continue();
        });
      }
      const pending = page.waitForRequest((outgoing) => outgoing.method() === 'POST' && outgoing.url().endsWith('/ai-image'));
      const generationStart = Date.now();
      await page.getByRole('button', { name: 'AIで生成', exact: true }).click();
      const outgoing = await pending;
      const payload = outgoing.postDataJSON() as QualityPayload;
      const inputOrder = await saveRequest(directory, payload);
      await saveJson(directory, 'metrics.json', { ...metrics, phase: 'submitted', generationRequests,
        inputOrder, generationId: payload.generationId, submittedAt: new Date().toISOString(),
        elapsedMs: Date.now() - start,
      });
      expect(payload.document).toEqual(garden);
      expect(imageBytes(payload.beforeDataUrl).equals(imageBytes(captured.before))).toBe(true);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: '庭の完成イメージ', exact: true })).toBeVisible();
      const response = await outgoing.response();
      expect(response).not.toBeNull();
      const generationElapsedMs = Date.now() - generationStart;
      if (!response!.ok()) {
        const alerts = page.getByRole('region', { name: 'AI完成イメージ生成' }).getByRole('alert');
        await alerts.first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
        await saveJson(directory, 'generation-error.json', { status: response!.status(),
          messages: await alerts.allTextContents(), elapsedMs: generationElapsedMs, generationRequests });
      }
      expect(response!.status()).toBe(200);
      // Read the application's result, not Chromium's size-limited inspector response cache.
      // One explicit generation may use the provider's existing 180-second communication limit.
      await expect(page.getByTestId('history-saved')).toBeVisible({ timeout: 180_000 });
      const afterImage = page.getByTestId('comparison-after');
      await expect(afterImage).toHaveAttribute('src', /^data:image\/png;base64,/, { timeout: 180_000 });
      const afterDataUrl = (await afterImage.getAttribute('src'))!;
      await writeFile(resolve(directory, 'after.png'), imageBytes(afterDataUrl));
      const providerFrame = await verifyProviderEvidence(directory, payload.generationId, afterDataUrl);
      const historyUrl = `${api}/gardens/${garden.id}/image-history`;
      const historyResponse = await request.get(`${historyUrl}/${payload.generationId}`);
      expect(historyResponse.status()).toBe(200);
      const saved = await historyResponse.json();
      expect(imageBytes(saved.beforeDataUrl).equals(imageBytes(captured.before))).toBe(true);
      expect(imageBytes(saved.afterDataUrl).equals(imageBytes(afterDataUrl))).toBe(true);
      expect(saved.document).toEqual(garden);
      const generated = { dataUrl: afterDataUrl, width: saved.width, height: saved.height,
        model: saved.model, quality: saved.quality, inputImageCount: saved.inputImageCount,
        generationMethod: saved.generationMethod,
        referenceSummary: saved.referenceSummary, historyId: saved.id, historySaved: true,
      };
      await expect(page.getByTestId('after-image')).toBeVisible();
      await page.screenshot({ path: resolve(directory, 'generated.png'), fullPage: true });
      const measurements = await measureOutput(page, captured.before, generated.dataUrl, payload.coverageDataUrl);
      await saveJson(directory, 'metrics.json', { ...metrics, ...measurements, phase: 'generated', inputOrder,
        generationRequests, generationElapsedMs,
        model: generated.model, quality: generated.quality, inputImageCount: generated.inputImageCount,
        referenceSummary: generated.referenceSummary, historyId: generated.historyId,
        historySaved: generated.historySaved, elapsedMs: Date.now() - start,
      });
      expect(generationRequests).toBe(1);
      expect(generated.width).toBe(providerFrame.width);
      expect(generated.quality).toBe(status.quality);
      expect(saved.quality).toBe(status.quality);
      expect(generated.height).toBe(providerFrame.height);
      expect(measurements.width).toBe(photo.imageWidth);
      expect(measurements.height).toBe(photo.imageHeight);
      expect(measurements.transparent).toBe(0);
      expect(measurements.coverageTransparent).toBe(0);
      expect(measurements.plantPixels).toBeGreaterThan(500);
      expect(measurements.changed).toBeGreaterThan(100);
      expect(generated.generationMethod).toBe('full_frame_v3');
      // These differences remain diagnostic measurements; full-frame output is not pixel-locked.
      if (name === 'overlap') expect(measurements.furniturePixels).toBeGreaterThan(500);
      expect(generated.inputImageCount).toBe(inputOrder.length);
      expect(generated.referenceSummary.every((item: { source: string }) => item.source === 'uploaded')).toBe(true);
      expect(generated.historySaved).toBe(true);
      expect(generated.historyId).toBe(payload.generationId);
      await saveJson(directory, 'history-summary.json', { id: saved.id, createdAt: saved.createdAt,
        model: saved.model, quality: saved.quality, referenceSummary: saved.referenceSummary,
        snapshotRevision: saved.snapshotRevision, beforeBytesMatch: true, afterBytesMatch: true });
      const afterDownload = await downloadImage(page, directory, 'After画像をPNGで保存', 'kusakari-after.png', generated.dataUrl);
      await page.keyboard.press('Escape');
      await page.reload();
      await expect(page.getByTestId('model-loaded')).toHaveText(`読み込み済み: ${garden.objects.length} / ${garden.objects.length}`);
      const reloaded = await readGarden(request, garden.id);
      expect(reloaded).toEqual(garden);
      await saveJson(directory, 'snapshot-reloaded.json', reloaded);
      await page.getByTestId('completion-menu-toggle').click();
      await page.getByRole('button', { name: '生成履歴', exact: true }).click();
      await page.getByTestId(`history-item-${generated.historyId}`).getByRole('button', { name: '比較する', exact: true }).click();
      await expect(page.getByTestId('comparison-before')).toHaveAttribute('src', captured.before);
      await expect(page.getByTestId('comparison-after')).toHaveAttribute('src', generated.dataUrl);
      const beforeDownload = await downloadImage(page, directory, 'Before画像をPNGで保存', 'kusakari-before.png', captured.before);
      await page.screenshot({ path: resolve(directory, 'reloaded.png'), fullPage: true });
      await saveJson(directory, 'metrics.json', { ...metrics, ...measurements, phase: 'live-complete', inputOrder,
        generationRequests, model: generated.model, quality: generated.quality,
        generationElapsedMs, elapsedMs: Date.now() - start,
        inputImageCount: generated.inputImageCount, referenceSummary: generated.referenceSummary,
        historyId: generated.historyId, historySaved: true, historyBytesMatch: true,
        afterDownload, beforeDownload, snapshotUnchanged: true, reloaded: true, coverageCaptured: true,
      });
    } catch (error) {
      await page.screenshot({ path: resolve(directory, 'failure.png'), fullPage: true }).catch(() => {});
      throw error;
    } finally {
      await removeScenes(request, ids);
    }
  });
}
