import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from './test.js';
import { api } from './api-url.js';
import { capture, createScene, openScene, readGarden, removeScenes, shrub } from './occlusion-helpers.js';
import { qualityPhoto, saveCapture, saveRequest, uploadReferences } from './ai-quality-helpers.js';
import { verifyProviderEvidence } from './ai-quality-evidence.js';

function fault(action: 'install' | 'remove', gardenId: string) {
  execFileSync(resolve('backend/.venv/Scripts/python.exe'),
    ['-m', 'verification.inject_history_failure', action, gardenId],
    { cwd: resolve('backend'), timeout: 30_000, stdio: 'pipe', windowsHide: true });
}

test('live output survives actual DB save failure and retries persistence without a second generation', async ({ page, request }) => {
  test.skip(process.env.KUSAKARI_CANVAS_AI_LIVE !== '1', 'Requires an explicitly enabled paid live run.');
  test.skip(process.env.KUSAKARI_CANVAS_HISTORY_FAULT_LIVE !== '1', 'DB fault injection requires a separate isolated live opt-in.');
  test.setTimeout(260_000);
  expect(process.env.KUSAKARI_CANVAS_AI_QUALITY_LIVE).toBe('1');
  expect(process.env.KUSAKARI_CANVAS_AI_EVIDENCE_DIR).toBeTruthy();
  const artifacts = resolve('artifacts/e2e/ai-quality', process.env.KUSAKARI_CANVAS_AI_QUALITY_RUN ?? 'full-frame-recovery');
  await mkdir(artifacts);
  const ids: string[] = [];
  let injectedId: string | null = null;
  let generationRequests = 0;
  let saveRequests = 0;
  const savedMethods: string[] = [];
  page.on('request', (outgoing) => {
    if (outgoing.method() !== 'POST') return;
    if (outgoing.url().endsWith('/ai-image')) generationRequests++;
    if (outgoing.url().endsWith('/image-history')) {
      saveRequests++;
      savedMethods.push(outgoing.postDataJSON().generationMethod);
    }
  });
  try {
    const photo = await qualityPhoto(page);
    const garden = await createScene(request, ids, photo, [shrub(0, 0)]);
    await openScene(page, garden);
    const before = await capture(page);
    await saveCapture(artifacts, garden, before);
    await uploadReferences(page, garden);
    fault('install', garden.id);
    injectedId = garden.id;
    const pending = page.waitForRequest((outgoing) => outgoing.method() === 'POST' && outgoing.url().endsWith('/ai-image'));
    await page.getByRole('button', { name: 'AIで生成（API利用料が発生します）', exact: true }).click();
    const outgoing = await pending;
    await saveRequest(artifacts, outgoing.postDataJSON());
    const response = await outgoing.response();
    expect(response?.status()).toBe(200);
    const historyId = outgoing.postDataJSON().generationId as string;
    expect(historyId).toMatch(/^[0-9a-f-]{36}$/);
    // Read rendered state and real history GETs; large POST responses can leave the inspector cache.
    const result = page.getByRole('region', { name: 'AI生成結果', exact: true });
    await expect(result.getByRole('button', { name: '履歴へ再保存', exact: true })).toBeVisible();
    await expect(result.getByRole('alert')).toContainText('履歴への保存に失敗しました');
    await expect(page.getByTestId('comparison-after')).toHaveAttribute('src', /^data:image\/png;base64,/);
    const afterDataUrl = (await page.getByTestId('comparison-after').getAttribute('src'))!;
    await verifyProviderEvidence(artifacts, historyId, afterDataUrl);
    await page.getByTestId('generation-details').locator('summary').first().click();
    await expect(page.getByTestId('generation-method-details')).toHaveAttribute('data-generation-method', 'full_frame_v3');
    await expect(page.getByTestId('generation-method-details')).toContainText('AI生成画像を全体採用');
    await mkdir(artifacts, { recursive: true });
    const pendingDownload = page.waitForEvent('download');
    await result.getByRole('link', { name: 'After画像をPNGで保存', exact: true }).click();
    const download = await pendingDownload;
    const unsavedPath = resolve(artifacts, 'history-live-recovery-unsaved.png');
    await download.saveAs(unsavedPath);
    expect(await readFile(unsavedPath)).toEqual(Buffer.from(afterDataUrl.split(',')[1], 'base64'));
    await expect(page.getByRole('button', { name: 'AIで生成（API利用料が発生します）', exact: true })).toBeDisabled();
    const url = `${api}/gardens/${garden.id}/image-history`;
    expect((await (await request.get(url)).json()).items).toHaveLength(0);
    await page.keyboard.press('Escape');
    const closeWarning = page.getByRole('dialog', { name: '未保存の画像を破棄して閉じますか？', exact: true });
    await expect(closeWarning).toBeVisible();
    await closeWarning.getByRole('button', { name: '画像を保持する', exact: true }).click();
    await expect(page.getByTestId('comparison-after')).toHaveAttribute('src', afterDataUrl);
    fault('remove', garden.id);
    injectedId = null;
    await page.route('**/image-history', (route) => route.abort(), { times: 1 });
    await page.getByRole('button', { name: '履歴へ再保存', exact: true }).click();
    await expect(page.getByRole('button', { name: '履歴へ再保存', exact: true })).toBeEnabled();
    await expect(page.getByTestId('comparison-after')).toHaveAttribute('src', afterDataUrl);
    await page.getByRole('button', { name: '履歴へ再保存', exact: true }).click();
    await expect(page.getByTestId('history-saved')).toBeVisible();
    expect(generationRequests).toBe(1);
    expect(saveRequests).toBe(2);
    expect(savedMethods).toEqual(['full_frame_v3', 'full_frame_v3']);
    const detail = await (await request.get(`${url}/${historyId}`)).json();
    expect(detail.beforeDataUrl).toBe(before.before);
    expect(detail.afterDataUrl).toBe(afterDataUrl);
    expect(detail.generationMethod).toBe('full_frame_v3');
    expect(detail.document).toEqual(garden);
    await page.keyboard.press('Escape');
    await page.reload();
    await page.getByTestId('completion-menu-toggle').click();
    await page.getByRole('button', { name: '生成履歴', exact: true }).click();
    await page.getByTestId(`history-item-${historyId}`).getByRole('button', { name: '比較する' }).click();
    await expect(page.getByTestId('comparison-after')).toHaveAttribute('src', afterDataUrl);
    await expect(page.getByTestId('generation-method-details')).toHaveAttribute('data-generation-method', 'full_frame_v3');
    expect(await readGarden(request, garden.id)).toEqual(garden);
    await mkdir(artifacts, { recursive: true });
    await page.screenshot({ path: resolve(artifacts, 'history-live-recovery-reloaded.png'), fullPage: true });
    await writeFile(resolve(artifacts, 'history-live-recovery-garden.json'), JSON.stringify(garden, null, 2));
    await writeFile(resolve(artifacts, 'history-live-recovery-metrics.json'), JSON.stringify({
      generationRequests, saveRequests, historyId, generationMethod: detail.generationMethod,
      savedMethods, unsavedDownloadBytesMatch: true,
      autoSaveFailed: true, recovered: true, reloaded: true, exactImageBytes: true,
    }, null, 2));
  } finally {
    if (injectedId) fault('remove', injectedId);
    await removeScenes(request, ids);
  }
});
