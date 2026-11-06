import { placeTestPlant, seedLegacyObjects } from './catalog-fixture';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Page, type APIRequestContext } from './test.js';
import { api as apiBase } from './api-url.js';
import type { GardenDocument } from '../frontend/src/types/garden.js';
import { createGardenFromList, renameGardenInEditor } from './garden-create';
import { seedGardenPhoto } from './garden-photo';
import { dragSelectedObject, moveSelectedObject, positionLabel, showTopView } from './transform-helpers';

const artifactDirectory = resolve('artifacts/e2e');
let createdGardenIds: string[] = [];

test.beforeEach(() => {
  createdGardenIds = [];
});

test.afterEach(async ({ request }) => {
  for (const id of createdGardenIds) {
    const response = await request.delete(`${apiBase}/gardens/${id}`);
    expect([204, 404]).toContain(response.status());
  }
});

async function createGarden(page: Page, name: string): Promise<string> {
  const id = await createGardenFromList(page);
  createdGardenIds.push(id);
  await expect(page.getByTestId('save-status')).toHaveText('保存済み');
  await renameGardenInEditor(page, name);
  return id;
}

async function placeTree(page: Page, x = 0.5, y = 0.5): Promise<void> {
  // 庭写真が未アップロードの庭には配置できないため、先に確定済みの写真を保存します（#15）。
  await seedGardenPhoto(page, new URL(page.url()).pathname.split('/').at(-1)!);
  await page.reload();
  await expect(page.getByTestId('save-status')).toHaveText('保存済み');
  await page.getByRole('button', { name: '3D庭', exact: true }).click();
  await page.getByRole('button', { name: '上から見る' }).click();
  const canvas = page.locator('[data-testid="garden-canvas"] canvas');
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('3Dキャンバスが表示されていません。');
  await placeTestPlant(page, bounds.x + bounds.width * x, bounds.y + bounds.height * y);
  await expect(page.getByTestId('object-row-0')).toBeVisible();
  await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 1 / 1');
}

async function gardenJson(request: APIRequestContext, id: string): Promise<GardenDocument> {
  const response = await request.get(`${apiBase}/gardens/${id}`);
  expect(response.ok()).toBeTruthy();
  return await response.json() as GardenDocument;
}

async function saveGardenArtifact(request: APIRequestContext, id: string, fileName: string): Promise<GardenDocument> {
  const document = await gardenJson(request, id);
  await mkdir(artifactDirectory, { recursive: true });
  await writeFile(resolve(artifactDirectory, fileName), `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  return document;
}

test('A. 庭作成からGLB配置・変形・保存・再読み込みまで', async ({ page, request }) => {
  const name = `E2E roundtrip ${Date.now()}`;
  const id = await createGarden(page, name);
  await placeTree(page);

  const canvas = page.locator('[data-testid="garden-canvas"] canvas');
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('3Dキャンバスが表示されていません。');
  const row = page.getByTestId('object-row-0').locator('small');
  const initial = await row.textContent();
  await page.mouse.move(bounds.x + bounds.width / 2 + 5, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 75, bounds.y + bounds.height / 2 + 8, { steps: 6 });
  await page.mouse.up();
  await expect(row).not.toHaveText(initial!);
  const moved = await row.textContent();
  await page.getByRole('button', { name: '上から見る' }).click();
  await expect(page.getByTestId('save-status')).toHaveText('保存済み');
  const stored = await saveGardenArtifact(request, id, 'garden-roundtrip.json');
  expect(stored.revision).toBeGreaterThan(0);
  expect(stored.objects).toHaveLength(1);
  expect(positionLabel(stored.objects[0].position)).toBe(moved);

  await page.reload();
  await page.getByRole('button', { name: '3D庭', exact: true }).click();
  await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 1 / 1');
  await expect(row).toHaveText(moved!);
  await expect(page.getByTestId('object-row-0')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '上から見る' }).click();
  await page.screenshot({ path: resolve(artifactDirectory, 'garden-roundtrip.png'), fullPage: true });
  await test.info().attach('garden-roundtrip.json', {
    body: JSON.stringify(stored, null, 2),
    contentType: 'application/json',
  });

  await page.getByRole('button', { name: '← 庭一覧' }).click();
  await page.waitForURL('/');
  const card = page.locator('.garden-card').filter({ hasText: name });
  await expect(card.locator('.garden-card-open')).toBeVisible();
  await card.locator('.garden-card-open').click();
  await page.getByRole('button', { name: '3D庭', exact: true }).click();
  await expect(page.locator('h1')).toHaveText(name);
  await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 1 / 1');
  await expect(row).toHaveText(moved!);

  await page.getByRole('button', { name: '← 庭一覧' }).click();
  await page.waitForURL('/');
  const deleteButton = card.getByRole('button', { name: `${name}のオプション` });
  await deleteButton.click();
  await card.getByRole('button', { name: '削除', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'この庭を削除しますか？' })).toContainText(name);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(card.locator('.garden-card-open')).toBeVisible();
  expect((await request.get(`${apiBase}/gardens/${id}`)).status()).toBe(200);

  await deleteButton.click();
  await card.getByRole('button', { name: '削除', exact: true }).click();
  await page.getByRole('button', { name: '庭を削除', exact: true }).click();
  await expect(card).toHaveCount(0);
  expect((await request.get(`${apiBase}/gardens/${id}`)).status()).toBe(404);
});

test('B. 同一GLBの配置、独立移動、削除', async ({ page, request }) => {
  const id = await createGarden(page, `E2E independent ${Date.now()}`);
  await placeTree(page, 0.42, 0.5);
  const canvas = page.locator('[data-testid="garden-canvas"] canvas');
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('3Dキャンバスが表示されていません。');
  await placeTestPlant(page, bounds.x + bounds.width * 0.65, bounds.y + bounds.height * 0.5);
  await expect(page.getByTestId('object-row-1')).toBeVisible();
  await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 2 / 2');
  await expect(page.getByTestId('save-status')).toHaveText('保存済み');

  const original = await gardenJson(request, id);
  const firstId = await page.getByTestId('object-row-0').getAttribute('data-object-id');
  const secondId = await page.getByTestId('object-row-1').getAttribute('data-object-id');
  if (!firstId || !secondId) throw new Error('配置一覧からオブジェクトIDを取得できませんでした。');
  const originalIds = [firstId, secondId];
  const secondPositionBefore = structuredClone(original.objects.find((object) => object.id === secondId)?.position);
  if (!secondPositionBefore) throw new Error('2個目の保存位置を取得できませんでした。');
  const firstBefore = original.objects.find((object) => object.id === firstId)!.position;
  await page.getByTestId('object-row-0').click();
  const firstMoved = await moveSelectedObject(page, request, id, -1, 0);
  const firstPosition = firstMoved.objects.find((object) => object.id === firstId)!.position;
  expect(firstPosition.x).toBeLessThan(firstBefore.x - 0.5);
  expect(firstMoved.objects.find((object) => object.id === secondId)?.position).toEqual(secondPositionBefore);

  // A third placement of the same model moves independently of the other two.
  await placeTestPlant(page, bounds.x + bounds.width * 0.5, bounds.y + bounds.height * 0.72);
  await expect(page.getByTestId('object-row-2')).toBeVisible();
  const thirdId = await page.getByTestId('object-row-2').getAttribute('data-object-id');
  expect(originalIds).not.toContain(thirdId);
  await expect.poll(async () => (await gardenJson(request, id)).objects.length).toBe(3);
  await expect(page.getByTestId('object-row-2')).toHaveAttribute('aria-pressed', 'true');
  await moveSelectedObject(page, request, id, 1, 0);
  await expect(page.getByTestId('object-row-0').locator('small')).toHaveText(positionLabel(firstPosition));
  await expect(page.getByTestId('object-row-1').locator('small')).toHaveText(positionLabel(secondPositionBefore));
  await page.getByTestId('object-toolbar').getByRole('button', { name: '削除', exact: true }).click();
  await expect(page.getByTestId('object-row-2')).toHaveCount(0);
  await expect(page.getByTestId('save-status')).toHaveText('保存済み');
  const stored = await saveGardenArtifact(request, id, 'garden-independent.json');
  expect(stored.objects).toHaveLength(2);
  const firstStored = stored.objects.find((object) => object.id === firstId);
  const secondStored = stored.objects.find((object) => object.id === secondId);
  expect(firstStored?.position).toEqual(firstPosition);
  expect(secondStored?.position).toEqual(secondPositionBefore);
  expect(new Set(stored.objects.map((object) => object.id)).size).toBe(2);
  await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 2 / 2');
});

test('C. 不正な寸法と配置位置を拒否し既存庭を維持', async ({ page, request }) => {
  await page.goto('/');
  const invalidCreate = await request.post(`${apiBase}/gardens`, { data: { name: 'invalid size', width: 51, depth: 8 } });
  expect(invalidCreate.status()).toBe(400);

  const id = await createGarden(page, `E2E validation ${Date.now()}`);
  await placeTree(page);
  await expect(page.getByTestId('save-status')).toHaveText('保存済み');
  const before = await gardenJson(request, id);
  const invalidDocument = structuredClone(before);
  invalidDocument.objects[0].position.x = invalidDocument.width / 2 + 1;
  const rejected = await request.put(`${apiBase}/gardens/${id}`, { data: invalidDocument });
  expect(rejected.status()).toBe(400);
  expect(await gardenJson(request, id)).toEqual(before);
});

test('D. 保存失敗後の編集保持と再試行', async ({ page, request }) => {
  const id = await createGarden(page, `E2E retry ${Date.now()}`);
  await page.route(`**/api/gardens/${id}`, async (route) => {
    if (route.request().method() === 'PUT') await route.abort('failed');
    else await route.continue();
  });
  await placeTree(page);
  // placeTreeが実APIで保存した写真の版。以降の画面からの保存は遮断されます。
  const savedRevision = (await gardenJson(request, id)).revision;
  const placed = await page.getByTestId('object-row-0').locator('small').textContent();
  // The failed save shows a banner that shifts the canvas; return to the top view before dragging.
  await expect(page.locator('.editor-alert[role="alert"]')).toContainText('自動保存できませんでした');
  await showTopView(page);
  await dragSelectedObject(page, await gardenJson(request, id), 1.2, 0);
  await expect(page.locator('.editor-alert[role="alert"]')).toContainText('自動保存できませんでした');
  await expect(page.locator('.editor-alert').getByRole('button', { name: '再試行', exact: true })).toBeEnabled();
  const local = await page.getByTestId('object-row-0').locator('small').textContent();
  expect(local).not.toBe(placed);
  expect((await gardenJson(request, id)).revision).toBe(savedRevision);
  await page.unroute(`**/api/gardens/${id}`);
  await page.locator('.editor-alert').getByRole('button', { name: '再試行', exact: true }).click();
  await expect(page.getByTestId('save-status')).toHaveText('保存済み');
  expect(positionLabel((await gardenJson(request, id)).objects[0].position)).toBe(local);
});

test('E. 古いrevisionの保存を競合として拒否しローカル編集を維持', async ({ page, request }) => {
  const id = await createGarden(page, `E2E conflict ${Date.now()}`);
  await placeTree(page);
  await expect(page.getByTestId('save-status')).toHaveText('保存済み');

  const serverDocument = await gardenJson(request, id);
  const competingDocument = structuredClone(serverDocument);
  competingDocument.objects[0].position.z = 1.25;
  const competingSave = await request.put(`${apiBase}/gardens/${id}`, { data: competingDocument });
  expect(competingSave.ok()).toBeTruthy();
  await dragSelectedObject(page, serverDocument, 2, 0);
  await expect(page.locator('.editor-alert[role="alert"]')).toContainText('別の保存結果と競合しました');
  await expect(page.locator('.editor-alert').getByRole('button', { name: '再試行', exact: true })).toBeEnabled();
  await expect(page.getByTestId('object-row-0').locator('small')).not.toHaveText(positionLabel(serverDocument.objects[0].position));
  const serverAfterConflict = await gardenJson(request, id);
  expect(serverAfterConflict.revision).toBe(serverDocument.revision + 1);
  expect(serverAfterConflict.objects[0].position.z).toBe(1.25);
  await saveGardenArtifact(request, id, 'garden-conflict.json');
});

test('F. 保存済み旧4種類のGLBを読み込み・復元', async ({ page, request }) => {
  const id = await createGarden(page, `E2E catalog ${Date.now()}`);
  await page.getByRole('button', { name: '3D庭', exact: true }).click();
  await page.getByRole('button', { name: '上から見る' }).click();
  const placements = ['tree_oak', 'shrub_boxwood', 'brick_paver', 'bench_wood'].map(assetId => ({ assetId }));
  await seedLegacyObjects(page, placements.map(p => p.assetId));
  await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 4 / 4');

  await expect(page.getByTestId('save-status')).toHaveText('保存済み');
  const stored = await saveGardenArtifact(request, id, 'garden-catalog.json');
  expect(stored.objects).toHaveLength(4);
  expect([...new Set(stored.objects.map((object) => object.assetId))].sort())
    .toEqual(placements.map((placement) => placement.assetId).sort());

  await page.reload();
  await page.getByRole('button', { name: '3D庭', exact: true }).click();
  await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 4 / 4');
  await page.getByRole('button', { name: '上から見る' }).click();
  await page.screenshot({ path: resolve(artifactDirectory, 'garden-catalog.png'), fullPage: true });
});

test('G. GLB読み込み失敗後に再試行して復旧', async ({ page, request }) => {
  const id = await createGarden(page, `E2E model retry ${Date.now()}`);
  await page.getByRole('button', { name: '3D庭', exact: true }).click();
  await page.getByRole('button', { name: '上から見る' }).click();
  await page.route('**/models/tree-oak.glb', (route) => route.abort('failed'));
  await seedLegacyObjects(page, ['tree_oak']);
  await expect(page.getByTestId('object-row-0')).toBeVisible();
  await expect(page.locator('.editor-alert[role="alert"]')).toContainText('モデルを読み込めません');
  await expect(page.getByRole('button', { name: 'モデルを再試行' })).toBeVisible();

  await page.unroute('**/models/tree-oak.glb');
  await page.getByRole('button', { name: 'モデルを再試行' }).click();
  await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 1 / 1');
  await expect(page.locator('.editor-alert[role="alert"]')).toHaveCount(0);
  await expect(page.getByTestId('save-status')).toHaveText('保存済み');
  const stored = await saveGardenArtifact(request, id, 'garden-model-retry.json');
  expect(stored.objects).toHaveLength(1);
  expect(stored.objects[0].assetId).toBe('tree_oak');
});

test('H. 回転リングのドラッグを保存して再読み込みできる', async ({ page, request }) => {
  const id = await createGarden(page, `E2E rotation handle ${Date.now()}`);
  await page.getByRole('button', { name: '3D庭', exact: true }).click();
  await page.getByRole('button', { name: '上から見る' }).click();
  await seedLegacyObjects(page, ['bench_wood']);
  const canvas = page.locator('[data-testid="garden-canvas"] canvas');
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('3Dキャンバスが表示されていません。');
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  await page.getByTestId('object-row-0').click();
  await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 1 / 1');
  await page.getByTestId('tool-rotate').click();

  // Top view: 1.4m ring projected from an 18m camera with a 42 degree field of view.
  const radius = 1.4 * bounds.height / (2 * 17.94 * Math.tan(21 * Math.PI / 180));
  await mkdir(artifactDirectory, { recursive: true });
  await page.screenshot({ path: resolve(artifactDirectory, 'garden-rotation-idle.png'), fullPage: true });
  await page.mouse.move(centerX + radius, centerY);
  await page.screenshot({ path: resolve(artifactDirectory, 'garden-rotation-hover.png'), fullPage: true });
  await page.mouse.click(centerX + radius, centerY);
  await expect(page.getByTestId('tool-rotate')).toBeEnabled();
  expect((await gardenJson(request, id)).objects[0].rotation.y).toBe(0);
  await page.mouse.move(centerX + radius, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX, centerY + radius, { steps: 6 });
  await expect(page.getByTestId('tool-rotate')).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.getByTestId('tool-rotate')).toBeEnabled();
  await page.waitForTimeout(800); // Longer than the autosave debounce: a cancelled drag saves nothing.
  expect((await gardenJson(request, id)).objects[0].rotation.y).toBe(0);
  await page.screenshot({ path: resolve(artifactDirectory, 'garden-rotation-cancel.png'), fullPage: true });
  await page.mouse.move(centerX + radius, centerY);
  await page.mouse.down();
  // Cross 90, 180 and 360 degrees while holding the pointer, then stop at 450.
  for (let step = 1; step <= 100; step += 1) {
    const angle = step / 100 * Math.PI * 2.5;
    await page.mouse.move(centerX + radius * Math.cos(angle), centerY - radius * Math.sin(angle));
  }
  await page.mouse.up();

  await expect(page.getByTestId('tool-rotate')).toBeEnabled();
  await expect(page.getByTestId('save-status')).toHaveText('保存済み');
  const degrees = (await gardenJson(request, id)).objects[0].rotation.y * 180 / Math.PI;
  expect(degrees).toBeCloseTo(450, 0);
  await expect(page.getByTestId('object-row-1')).toHaveCount(0);
  expect((await gardenJson(request, id)).objects).toHaveLength(1);
  await expect(page.getByTestId('save-status')).toHaveText('保存済み');
  const stored = await saveGardenArtifact(request, id, 'garden-rotation-handle.json');
  expect(stored.objects).toHaveLength(1);
  expect(stored.objects[0].rotation.y).toBeCloseTo(degrees * Math.PI / 180, 2);
  expect(stored.objects[0].rotation.x).toBe(0);
  expect(stored.objects[0].rotation.z).toBe(0);

  await page.reload();
  await page.getByRole('button', { name: '3D庭', exact: true }).click();
  await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 1 / 1');
  expect(await gardenJson(request, id)).toEqual(stored);
  await page.getByRole('button', { name: '上から見る' }).click();
  await page.screenshot({ path: resolve(artifactDirectory, 'garden-rotation-handle.png'), fullPage: true });
});
