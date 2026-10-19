import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { GardenDocument } from '../frontend/src/types/garden';
import { syntheticPhoto } from './occlusion-helpers';

const api = 'http://127.0.0.1:18081/api';
const ec = 'http://127.0.0.1:15286';
const evidence = process.env.KUSAKARI_AUTOSAVE_EVIDENCE!;
const fixtures: { productIds: string[]; gardenIds: string[]; cartIds: string[] } = { productIds: [], gardenIds: [], cartIds: [] };
test.skip(!evidence, 'Use playwright.autosave.config.ts with dedicated data');
async function record() {
  await mkdir(evidence, { recursive: true });
  try {
    const previous = JSON.parse(await readFile(`${evidence}/fixtures.json`, 'utf8'));
    fixtures.cartIds = [...new Set([...previous.cartIds, ...fixtures.cartIds])];
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  await writeFile(`${evidence}/fixtures.json`, JSON.stringify(fixtures, null, 2));
}
test.afterEach(async ({ page, request }) => {
  for (const cookie of await page.context().cookies()) {
    if (cookie.name === 'kusakari_cart') fixtures.cartIds.push(cookie.value);
  }
  for (const id of [...fixtures.gardenIds]) {
    expect([204, 404]).toContain((await request.delete(`${api}/gardens/${id}`)).status());
    fixtures.gardenIds = fixtures.gardenIds.filter(value => value !== id);
  }
  await record();
});
async function read(request: APIRequestContext, id: string): Promise<GardenDocument> {
  const response = await request.get(`${api}/gardens/${id}`);
  expect(response.status()).toBe(200);
  return response.json();
}
async function scene(page: Page, request: APIRequestContext, bench = true) {
  const response = await request.post(`${api}/gardens`, { data: { name: `E2E autosave ${randomUUID()}`, width: 20, depth: 16 } });
  expect(response.status()).toBe(201);
  let garden = await response.json() as GardenDocument;
  fixtures.gardenIds.push(garden.id);
  await record();
  if (bench) {
    const result = await request.put(`${api}/gardens/${garden.id}`, { data: { ...garden, objects: [{
      id: randomUUID(), assetId: 'bench_wood', position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
    }] } });
    expect(result.status()).toBe(200);
    garden = await result.json();
  }
  await page.goto(`/gardens/${garden.id}`);
  await expect(page.getByTestId('model-loaded')).toHaveText(`読み込み済み: ${garden.objects.length} / ${garden.objects.length}`);
  return garden;
}
async function saved(page: Page, request: APIRequestContext, id: string, revision: number) {
  await expect.poll(async () => (await read(request, id)).revision).toBeGreaterThanOrEqual(revision);
  await expect(page.getByTestId('save-status')).toHaveText('保存済み');
  return read(request, id);
}
async function reloadedEvidence(page: Page, request: APIRequestContext, id: string, name: string) {
  const stored = await read(request, id);
  await page.goto(`/gardens/${id}`);
  await page.reload();
  await expect(page.getByTestId('model-loaded')).toHaveText(`読み込み済み: ${stored.objects.length} / ${stored.objects.length}`);
  expect(await read(request, id)).toEqual(stored);
  await writeFile(`${evidence}/${name}-garden.json`, JSON.stringify(stored, null, 2));
  await page.screenshot({ path: `${evidence}/${name}-reloaded.png` });
}

test('merged toolbar fits 7 widths in both views and transform, duplicate, delete edits autosave', async ({ page, request }) => {
  const garden = await scene(page, request);
  await expect(page.getByTestId('save-garden')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '植物候補を相談', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '買い物リストをECで確認', exact: true })).toHaveCount(0);
  const layouts = [];
  for (const width of [1528, 1280, 1100, 1000, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const mode of ['3d', 'photo']) {
      await page.getByRole('button', { name: mode === '3d' ? '3D庭' : '写真＋設計', exact: true }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.locator('.document-bar')).toHaveCount(0);
      const toolbar = page.locator('.canvas-tools');
      const bounds = (await toolbar.boundingBox())!;
      const identity = (await toolbar.locator('.document-identity').boundingBox())!;
      const title = (await toolbar.getByRole('heading', { name: garden.name, exact: true }).boundingBox())!;
      const status = (await toolbar.getByTestId('save-status').boundingBox())!;
      const modes = (await toolbar.getByRole('group', { name: '表示モード' }).boundingBox())!;
      const camera = (await toolbar.locator('.camera-actions').boundingBox())!;
      expect(title.width).toBeGreaterThan(12);
      expect(title.x + title.width).toBeLessThanOrEqual(status.x);
      expect(status.x + status.width).toBeLessThanOrEqual(identity.x + identity.width + 1);
      expect(identity.x + identity.width).toBeLessThanOrEqual(modes.x);
      if (camera.y < modes.y + modes.height) expect(modes.x + modes.width).toBeLessThanOrEqual(camera.x);
      await expect(toolbar.getByTestId('save-status')).toHaveAttribute('title', '保存済み');
      for (const button of await toolbar.getByRole('button').all()) {
        const item = (await button.boundingBox())!;
        expect(item.x).toBeGreaterThanOrEqual(bounds.x);
        expect(item.x + item.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
        expect(item.y).toBeGreaterThanOrEqual(bounds.y);
        expect(item.y + item.height).toBeLessThanOrEqual(bounds.y + bounds.height);
      }
      expect(bounds.height).toBeLessThanOrEqual(mode === 'photo' || bounds.width > 480 ? 54 : 96);
      if (bounds.width > 900) expect(Math.abs(modes.x + modes.width / 2 - bounds.x - bounds.width / 2)).toBeLessThan(2);
      layouts.push({ width, mode, toolbar: bounds, title, status, canvas: await page.locator('.canvas-column').boundingBox() });
    }
  }
  await writeFile(`${evidence}/layout.json`, JSON.stringify(layouts, null, 2));
  await page.screenshot({ path: `${evidence}/compact-mobile.png` });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: '3D庭', exact: true }).click();
  await page.getByRole('button', { name: '商品・買い物リストパネルを隠す', exact: true }).click();
  const expanded = (await page.locator('.canvas-tools').boundingBox())!;
  expect(expanded.width).toBeGreaterThan(1300);
  await expect(page.locator('.canvas-tools h1')).toHaveText(garden.name);
  await page.getByRole('button', { name: '商品・買い物リストパネルを表示', exact: true }).click();
  await page.getByTestId('object-details-toggle').click();
  await page.getByTestId('position-x').fill('1.5');
  await page.getByTestId('rotation-y').fill('35');
  await page.getByTestId('uniform-scale').fill('1.2');
  const transformed = await saved(page, request, garden.id, garden.revision + 1);
  expect(transformed.objects[0].position.x).toBe(1.5);
  expect(transformed.objects[0].rotation.y).toBeCloseTo(35 * Math.PI / 180, 5);
  expect(transformed.objects[0].scale.x).toBe(1.2);
  await page.getByRole('button', { name: '複製', exact: true }).click();
  await expect.poll(async () => (await read(request, garden.id)).objects.length).toBe(2);
  await page.getByRole('button', { name: '削除', exact: true }).click();
  await expect.poll(async () => (await read(request, garden.id)).objects.length).toBe(1);
  await expect(page.getByTestId('save-status')).toHaveText('保存済み');
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: /買い物リスト/ }).click();
  await expect(page.getByRole('button', { name: 'ECで買い物リストを確認', exact: true })).toHaveCount(1);
  await expect(page.getByRole('tabpanel', { name: /買い物リスト/ }).getByRole('button', { name: 'ECで買い物リストを確認', exact: true })).toBeVisible();
  await reloadedEvidence(page, request, garden.id, 'transform');
  await page.getByRole('button', { name: '← 庭一覧', exact: true }).click();
  await expect(page).toHaveURL('http://127.0.0.1:15173/');
});

test('dimensions, photo upload, confirmed boundary, edge length and photo removal autosave', async ({ page, request }) => {
  const garden = await scene(page, request, false);
  await page.getByRole('button', { name: '土台設定', exact: true }).click();
  await page.getByLabel('幅 (m)', { exact: true }).fill('18');
  await page.getByLabel('奥行き (m)', { exact: true }).fill('14');
  await page.getByRole('button', { name: '土台に適用', exact: true }).click();
  const resized = await saved(page, request, garden.id, garden.revision + 1);
  expect([resized.width, resized.depth]).toEqual([18, 14]);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '写真＋設計', exact: true }).click();
  const photo = await syntheticPhoto(page, 600, 400);
  await page.getByLabel('庭の写真を選択').setInputFiles({ name: 'autosave.png', mimeType: 'image/png', buffer: Buffer.from(photo.dataUrl.split(',')[1], 'base64') });
  await expect(page.getByTestId('save-status')).toHaveText('輪郭を描画中');
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'pending');
  await page.waitForTimeout(750); // Past the debounce window: unconfirmed drafts must not be submitted.
  expect((await read(request, garden.id)).photo).toBeNull();
  for (const [x, y] of [[.15, .8], [.85, .8], [.8, .2], [.2, .2]]) {
    const point = await page.locator('.photo-stage').evaluate((node, p) => {
      const screen = new DOMPoint(p.x * 600, p.y * 400).matrixTransform((node as SVGSVGElement).getScreenCTM()!);
      return { x: screen.x, y: screen.y };
    }, { x, y });
    await page.mouse.click(point.x, point.y);
  }
  await page.getByRole('button', { name: '始点につないで輪郭を確定', exact: true }).click();
  const withPhoto = await saved(page, request, garden.id, resized.revision + 1);
  expect(withPhoto.photo!.dataUrl).toBe(photo.dataUrl);
  expect(withPhoto.photo!.boundary).toHaveLength(4);
  await page.getByTestId('photo-edge-0').click();
  const edge = page.getByRole('dialog', { name: '選択した辺の長さ' });
  await edge.getByLabel('辺の長さ（m）').fill('12');
  await edge.getByRole('button', { name: '長さを適用' }).click();
  const scaled = await saved(page, request, garden.id, withPhoto.revision + 1);
  expect(scaled.width).not.toBe(withPhoto.width);
  expect(scaled.photo!.boundary).toEqual(withPhoto.photo!.boundary);
  await page.keyboard.press('Escape');
  await reloadedEvidence(page, request, garden.id, 'photo-and-dimensions');
  await page.getByRole('button', { name: '写真を外す', exact: true }).click();
  const removed = await saved(page, request, garden.id, scaled.revision + 1);
  expect(removed.photo).toBeNull();
  await reloadedEvidence(page, request, garden.id, 'photo-removed');
});

test('delayed save allows newer edits, serializes revisions and flushes before EC navigation', async ({ page, request }) => {
  const garden = await scene(page, request);
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const firstStarted = new Promise<void>(resolve => { started = resolve; });
  const snapshots: GardenDocument[] = [];
  await page.route(`**/api/gardens/${garden.id}`, async route => {
    if (route.request().method() !== 'PUT') { await route.continue(); return; }
    snapshots.push(route.request().postDataJSON());
    if (snapshots.length === 1) { started(); await gate; } // Latency fault; the real API still handles the request.
    await route.continue();
  });
  try {
    await page.getByTestId('object-details-toggle').click();
    await page.getByTestId('position-x').fill('1.5');
    await firstStarted;
    await expect(page.getByTestId('save-status')).toHaveText('保存中…');
    await expect(page.getByTestId('position-z')).toBeEnabled();
    await page.getByTestId('position-z').fill('2.5');
    await page.getByTestId('rotation-y').fill('45');
    await page.waitForTimeout(650);
    expect(snapshots).toHaveLength(1);
    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: /買い物リスト/ }).click();
    await page.getByRole('button', { name: 'ECで買い物リストを確認', exact: true }).click();
    expect(page.url()).toContain(`/gardens/${garden.id}`);
    release();
    await expect(page).toHaveURL(`${ec}/cart/gardens/${garden.id}`);
    const stored = await read(request, garden.id);
    expect(stored.revision).toBe(garden.revision + 2);
    expect(snapshots).toHaveLength(2);
    expect(snapshots.map(item => item.revision)).toEqual([garden.revision, garden.revision + 1]);
    expect(stored.objects[0].position).toEqual({ x: 1.5, y: 0, z: 2.5 });
    expect(stored.objects[0].rotation.y).toBeCloseTo(Math.PI / 4, 5);
    await page.screenshot({ path: `${evidence}/ec-after-flush.png` });
    await reloadedEvidence(page, request, garden.id, 'concurrent-edits');
  } finally { release(); }
});

test('offline save keeps edits, stops retry storms and supports an explicit retry', async ({ page, request }) => {
  const garden = await scene(page, request);
  let attempts = 0;
  await page.route(`**/api/gardens/${garden.id}`, async route => {
    if (route.request().method() === 'PUT') { attempts++; await route.abort('failed'); }
    else await route.continue();
  });
  await page.getByTestId('object-details-toggle').click();
  await page.getByTestId('position-x').fill('3');
  await expect(page.getByTestId('save-status')).toHaveText('保存できませんでした');
  await page.waitForTimeout(1200);
  expect(attempts).toBe(1);
  expect((await read(request, garden.id)).objects[0].position.x).toBe(0);
  await expect(page.getByTestId('position-x')).toHaveValue('3');
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: /買い物リスト/ }).click();
  await page.getByRole('button', { name: 'ECで買い物リストを確認', exact: true }).click();
  await expect(page.locator('.editor-alert')).toContainText('自動保存できませんでした');
  expect(page.url()).toContain(`/gardens/${garden.id}`);
  await page.unroute(`**/api/gardens/${garden.id}`);
  await page.locator('.editor-alert').getByRole('button', { name: '再試行', exact: true }).click();
  expect((await saved(page, request, garden.id, garden.revision + 1)).objects[0].position.x).toBe(3);
  await reloadedEvidence(page, request, garden.id, 'offline-recovered');
});

test('new edits during a pending request autosave again without a navigation or save action', async ({ page, request }) => {
  const garden = await scene(page, request);
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const firstStarted = new Promise<void>(resolve => { started = resolve; });
  let requests = 0;
  await page.route(`**/api/gardens/${garden.id}`, async route => {
    if (route.request().method() === 'PUT' && ++requests === 1) { started(); await gate; }
    await route.continue();
  });
  try {
    await page.getByTestId('object-details-toggle').click();
    await page.getByTestId('position-x').fill('2');
    await firstStarted;
    await page.getByTestId('position-z').fill('3');
    await page.getByTestId('uniform-scale').fill('1.4');
    release();
    const stored = await saved(page, request, garden.id, garden.revision + 2);
    expect(requests).toBe(2);
    expect(stored.objects[0].position).toEqual({ x: 2, y: 0, z: 3 });
    expect(stored.objects[0].scale.x).toBe(1.4);
    await expect(page.getByTestId('position-z')).toHaveValue('3');
    await reloadedEvidence(page, request, garden.id, 'automatic-followup');
  } finally { release(); }
});

test('a real revision conflict preserves both remote and local changes without repeated writes', async ({ page, request }) => {
  const garden = await scene(page, request);
  const remote = await request.put(`${api}/gardens/${garden.id}`, { data: { ...garden, name: garden.name + ' remote' } });
  expect(remote.status()).toBe(200);
  let attempts = 0;
  page.on('request', req => { if (req.method() === 'PUT' && req.url().endsWith(`/api/gardens/${garden.id}`)) attempts++; });
  await page.getByTestId('object-details-toggle').click();
  await page.getByTestId('position-x').fill('4');
  await expect(page.locator('.editor-alert')).toContainText('競合しました');
  await expect(page.getByTestId('position-x')).toHaveValue('4');
  await page.waitForTimeout(1200);
  expect(attempts).toBe(1);
  const stored = await read(request, garden.id);
  expect(stored.name).toContain('remote');
  expect(stored.objects[0].position.x).toBe(0);
  await page.screenshot({ path: `${evidence}/conflict-local-retained.png` });
  await writeFile(`${evidence}/conflict-server-garden.json`, JSON.stringify(stored, null, 2));
  // Explicitly accept discarding this test-only draft, then verify the real stored version.
  page.on('dialog', dialog => dialog.accept());
  await reloadedEvidence(page, request, garden.id, 'conflict-server');
});
