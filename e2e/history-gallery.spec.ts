import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { api } from './api-url';
import { createScene, openScene, readGarden, removeScenes, shrub, syntheticPhoto } from './occlusion-helpers';

const evidence = process.env.KUSAKARI_HISTORY_GALLERY_EVIDENCE!;
test.skip(!evidence, 'Use the dedicated history gallery config and MySQL databases');
const fixtures = { productIds: [] as string[], gardenIds: [] as string[], cartIds: [] as string[] };
let generationRequests = 0;
async function record() {
  await mkdir(evidence, { recursive: true });
  try {
    const previous = JSON.parse(await readFile(`${evidence}/fixtures.json`, 'utf8'));
    fixtures.cartIds = [...new Set([...previous.cartIds, ...fixtures.cartIds])];
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  await writeFile(`${evidence}/fixtures.json`, JSON.stringify(fixtures, null, 2));
}
test.beforeEach(async ({ page }) => {
  generationRequests = 0;
  page.on('request', outgoing => { if (outgoing.url().endsWith('/ai-image')) generationRequests++; });
});
test.afterEach(async ({ page, request }) => {
  for (const cookie of await page.context().cookies()) if (cookie.name === 'kusakari_cart') fixtures.cartIds.push(cookie.value);
  await removeScenes(request, fixtures.gardenIds);
  fixtures.gardenIds = [];
  await record();
  expect(generationRequests, 'No paid generation should be attempted').toBe(0);
});

async function seed(page: Page, request: APIRequestContext, count: number) {
  const photo = await syntheticPhoto(page, 320, 240);
  const garden = await createScene(request, fixtures.gardenIds, photo, [shrub(0, 0)]);
  await record();
  const url = `${api}/gardens/${garden.id}/image-history`;
  const sources = [];
  for (const [width, height] of [[1200, 800], [800, 1200], [1200, 400]]) {
    const after = await page.evaluate(({ width, height }) => {
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d')!;
      for (const [x, y, color] of [[0, 0, '#dc2828'], [.5, 0, '#28be46'], [0, .5, '#2850dc'], [.5, .5, '#f0c828']] as const) {
        context.fillStyle = color;
        context.fillRect(width * x, height * y, width / 2, height / 2);
      }
      context.fillStyle = 'white';
      context.font = `${Math.round(width / 20)}px sans-serif`;
      context.textAlign = 'center';
      context.fillText('HISTORY FIXTURE', width / 2, height / 2);
      return canvas.toDataURL('image/png');
    }, { width, height });
    sources.push({ after, width, height });
  }
  const items = [];
  for (let index = 0; index < count; index++) {
    const source = sources[index % sources.length];
    // Controlled storage fixtures, not generated AI outputs or mocked API responses.
    const payload = { id: randomUUID(), document: garden, beforeDataUrl: photo.dataUrl, afterDataUrl: source.after,
      model: 'gpt-image-2.5-sunburst', quality: 'medium', generationMethod: 'full_frame_v3', inputImageCount: 2,
      referenceSummary: [{ assetId: 'shrub_boxwood', productId: 'history-gallery-fixture', productName: 'E2E storage fixture', source: 'uploaded' }] };
    const response = await request.post(url, { data: payload });
    expect(response.status(), await response.text()).toBe(200);
    items.unshift({ ...await response.json(), ...source, payload });
  }
  return { garden, url, items };
}
async function openHistory(page: Page) {
  await page.getByTestId('completion-menu-toggle').click();
  await page.getByRole('button', { name: '生成履歴', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '生成履歴', exact: true })).toBeVisible();
}
async function persisted(page: Page, request: APIRequestContext, id: string, name: string) {
  const stored = await readGarden(request, id);
  await page.reload();
  if (!stored.photo) await page.getByRole('button', { name: '3D庭', exact: true }).click();
  await expect(page.getByTestId('completion-menu-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('model-loaded')).toHaveText(`読み込み済み: ${stored.objects.length} / ${stored.objects.length}`);
  expect(await readGarden(request, id)).toEqual(stored);
  await writeFile(`${evidence}/${name}-garden.json`, JSON.stringify(stored, null, 2));
  await page.screenshot({ path: `${evidence}/${name}-reloaded.png` });
}

test('one closed button nests history, supports keyboard and outside dismissal, and retains capture', async ({ page, request }) => {
  const { garden } = await seed(page, request, 0);
  let historyReads = 0;
  page.on('request', outgoing => { if (/\/api\/gardens\/[^/]+\/image-history/.test(outgoing.url())) historyReads++; });
  await openScene(page, garden);
  const toggle = page.getByTestId('completion-menu-toggle');
  await expect(toggle).toHaveText('AI生成');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('completion-launcher').getByRole('button')).toHaveCount(1);
  for (const width of [1528, 1000, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await toggle.click();
    const menu = page.getByRole('region', { name: '完成イメージメニュー', exact: true });
    await expect(menu).toBeVisible();
    const bounds = (await menu.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    await expect(menu.getByRole('button', { name: '完成イメージを確認', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  }
  expect(historyReads).toBe(0);
  await toggle.click();
  await page.locator('.canvas-tools h1').click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await toggle.click();
  await page.screenshot({ path: `${evidence}/nested-menu.png` });
  if (!await page.getByRole('button', { name: '完成イメージを確認', exact: true }).isVisible()) await page.getByRole('button', { name: /^(AI生成|完成イメージ)メニュー$/ }).click();

  await page.getByRole('button', { name: '完成イメージを確認', exact: true }).click();
  await expect(page.getByTestId('before-image')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(toggle).toBeFocused();
  await openHistory(page);
  await expect(page.getByText('保存された生成履歴はありません。')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(toggle).toBeFocused();
  await persisted(page, request, garden.id, 'closed-menu');
});

test('thumbnail gallery fits portrait and landscape originals, loads detail on selection and downloads exact bytes', async ({ page, request }) => {
  const { garden, url, items } = await seed(page, request, 6);
  let detailReads = 0;
  page.on('request', outgoing => { if (/\/image-history\/[0-9a-f-]{36}$/.test(outgoing.url())) detailReads++; });
  await openScene(page, garden);
  await openHistory(page);
  const history = page.getByRole('dialog', { name: '生成履歴', exact: true });
  await expect(history.locator('.history-card')).toHaveCount(6);
  expect(detailReads).toBe(0);
  for (const item of items.slice(0, 3)) {
    const thumbnail = await request.get(`${url}/${item.id}/thumbnail`);
    expect(thumbnail.status()).toBe(200);
    expect(thumbnail.headers()['content-type']).toContain('image/png');
    expect(thumbnail.headers()['cache-control']).toBe('private, no-cache');
    const image = page.getByTestId(`history-item-${item.id}`).getByRole('img');
    await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true);
    await expect(image).toHaveCSS('object-fit', 'contain');
    const pixels = await image.evaluate((node: HTMLImageElement) => {
      const canvas = document.createElement('canvas');
      canvas.width = node.naturalWidth; canvas.height = node.naturalHeight;
      const context = canvas.getContext('2d')!;
      context.drawImage(node, 0, 0);
      return { width: canvas.width, height: canvas.height, corners: [[.1, .1], [.9, .1], [.1, .9], [.9, .9]].map(([x, y]) =>
        Array.from(context.getImageData(Math.floor(x * canvas.width), Math.floor(y * canvas.height), 1, 1).data)) };
    });
    expect(pixels.width).toBeLessThanOrEqual(640);
    expect(pixels.height).toBeLessThanOrEqual(400);
    expect(pixels.width / pixels.height).toBeCloseTo(item.width / item.height, 2);
    expect(pixels.corners).toEqual([[220, 40, 40, 255], [40, 190, 70, 255], [40, 80, 220, 255], [240, 200, 40, 255]]);
  }
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const gallery = history.locator('.generation-history-list');
    expect(await gallery.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    const first = (await gallery.locator('li').first().boundingBox())!;
    const second = (await gallery.locator('li').nth(1).boundingBox())!;
    expect(first.y).toBe(second.y);
    expect(second.x).toBeGreaterThan(first.x + first.width);
    await page.screenshot({ path: `${evidence}/gallery-${width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  const chosen = items[1];
  await page.getByTestId(`history-item-${chosen.id}`).getByRole('button', { name: '比較する', exact: true }).click();
  await expect(page.getByTestId('comparison-after')).toHaveAttribute('src', chosen.after);
  await expect(history.locator('.history-card')).toHaveCount(0);
  const range = page.getByRole('slider', { name: 'Before／Afterの比較位置', exact: true });
  await range.focus();
  await range.press('Home');
  await expect(range).toHaveValue('0');
  expect(await page.getByTestId('comparison-before').boundingBox()).toEqual(await page.getByTestId('comparison-after').boundingBox());
  await page.screenshot({ path: `${evidence}/comparison.png` });
  const pending = page.waitForEvent('download');
  await history.getByRole('link', { name: 'After画像をPNGで保存', exact: true }).click();
  await (await pending).saveAs(`${evidence}/original-after.png`);
  expect(await readFile(`${evidence}/original-after.png`)).toEqual(Buffer.from(chosen.after.split(',')[1], 'base64'));
  await history.getByRole('button', { name: '履歴一覧に戻る', exact: true }).click();
  await expect(page.getByTestId(`history-item-${chosen.id}`).getByRole('button', { name: '比較する', exact: true })).toBeFocused();
  const other = await seed(page, request, 0);
  expect((await request.get(`${other.url}/${chosen.id}/thumbnail`)).status()).toBe(404);
  expect((await request.get(`${url}/not-a-uuid/thumbnail`)).status()).toBe(400);
  const detail = await (await request.get(`${url}/${chosen.id}`)).json();
  expect(detail.document).toEqual(garden);
  expect(detail.afterDataUrl).toBe(chosen.after);
  await persisted(page, request, garden.id, 'gallery');
});

test('history and thumbnail failures retry independently, deletion requires confirmation and preserves other images', async ({ page, request }) => {
  const { garden, url, items } = await seed(page, request, 2);
  const chosen = items[0];
  await openScene(page, garden);
  await page.route('**/image-history?*', route => route.abort(), { times: 1 });
  await page.route(`**/image-history/${chosen.id}/thumbnail`, route => route.abort(), { times: 1 });
  await openHistory(page);
  await page.getByRole('button', { name: '履歴を再取得', exact: true }).click();
  const row = page.getByTestId(`history-item-${chosen.id}`);
  await row.getByRole('button', { name: 'サムネイルを再取得', exact: true }).click();
  await expect.poll(() => row.getByRole('img').evaluate((image: HTMLImageElement) => image.naturalWidth > 0)).toBe(true);
  await page.route(`**/image-history/${chosen.id}`, route => route.abort(), { times: 1 });
  await row.getByRole('button', { name: '比較する', exact: true }).click();
  await page.getByRole('button', { name: '比較画像を再取得', exact: true }).click();
  await expect(page.getByTestId('comparison-after')).toHaveAttribute('src', chosen.after);
  await page.getByRole('button', { name: 'この履歴を削除', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: '生成履歴を削除', exact: true });
  await confirmation.getByRole('button', { name: '取消', exact: true }).click();
  expect((await request.get(`${url}/${chosen.id}`)).status()).toBe(200);
  await page.getByRole('button', { name: 'この履歴を削除', exact: true }).click();
  await page.route(`**/image-history/${chosen.id}`, route => route.abort(), { times: 1 });
  await confirmation.getByRole('button', { name: '削除する', exact: true }).click();
  await expect(confirmation.getByRole('alert')).toBeVisible();
  await confirmation.getByRole('button', { name: '削除する', exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(page.locator('.history-card')).toHaveCount(1);
  expect((await request.get(`${url}/${chosen.id}/thumbnail`)).status()).toBe(404);
  expect((await request.get(`${url}/${items[1].id}/thumbnail`)).status()).toBe(200);
  await persisted(page, request, garden.id, 'retry-and-delete');
});

test('paged gallery retains historical images when the current photo is removed', async ({ page, request }) => {
  const { garden, url, items } = await seed(page, request, 22);
  expect((await request.put(`${api}/gardens/${garden.id}`, { data: { ...garden, photo: null } })).status()).toBe(200);
  await page.goto(`/gardens/${garden.id}`);
  await page.getByRole('button', { name: '3D庭', exact: true }).click();
  await expect(page.getByTestId('completion-menu-toggle')).toHaveText('完成イメージ');
  await openHistory(page);
  await expect(page.locator('.history-card')).toHaveCount(20);
  await page.getByRole('button', { name: 'さらに読み込む', exact: true }).click();
  await expect(page.locator('.history-card')).toHaveCount(22);
  await page.getByTestId(`history-item-${items[21].id}`).getByRole('button', { name: '比較する', exact: true }).click();
  await expect(page.getByTestId('comparison-after')).toHaveAttribute('src', items[21].after);
  await page.getByRole('button', { name: '履歴一覧に戻る', exact: true }).click();
  await expect(page.locator('.history-card')).toHaveCount(22);
  expect((await (await request.get(`${url}/${items[21].id}`)).json()).document.photo).toEqual(garden.photo);
  await persisted(page, request, garden.id, 'pagination');
});
