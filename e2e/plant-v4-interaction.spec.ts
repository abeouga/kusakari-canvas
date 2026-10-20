import { seedLegacyObjects } from './catalog-fixture';
import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const api = (process.env.KUSAKARI_CANVAS_E2E_API_URL ? process.env.KUSAKARI_CANVAS_E2E_API_URL + '/api' : 'http://127.0.0.1:18081/api'), evidence = 'artifacts/plant-v4/interaction';
type RenderMetrics = { frame: number; calls: number; triangles: number };
declare global { interface Window { plantRenderSnapshot: () => RenderMetrics } }

test('demand renderer: idle, camera, live drag, rotation cancellation, capture and reload', async ({ page, request }) => {
  const response = await request.post(`${api}/gardens`, { data: { name: `描画検証-${randomUUID().slice(0, 8)}`, width: 10, depth: 10 } });
  expect(response.status()).toBe(201); const garden = await response.json();
  await mkdir(evidence, { recursive: true }); const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(`/gardens/${garden.id}?renderReview`);
    await page.getByRole('button', { name: '3D庭', exact: true }).click();
    await page.getByRole('button', { name: '上から見る', exact: true }).click();
    await seedLegacyObjects(page, ['bench_wood']);
    const canvas = page.getByTestId('garden-canvas').locator('canvas'), box = await canvas.boundingBox();
    if (!box) throw new Error('Missing canvas');
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    await page.mouse.click(cx, cy);
    await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 1 / 1');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1800);
    const idleStart = await page.evaluate(() => window.plantRenderSnapshot());
    await page.waitForTimeout(2000);
    const idleEnd = await page.evaluate(() => window.plantRenderSnapshot());
    expect(idleEnd.frame - idleStart.frame).toBe(0);
    await page.getByTestId('object-row-0').click();
    await page.getByTestId('tool-move').click();
    await page.waitForTimeout(500);
    const beforeDrag = await page.evaluate(() => window.plantRenderSnapshot());
    await page.mouse.move(cx - 14, cy); await page.mouse.down();
    await page.mouse.move(cx + 24, cy + 24, { steps: 12 });
    const duringDrag = await page.evaluate(() => window.plantRenderSnapshot());
    expect(duringDrag.frame).toBeGreaterThan(beforeDrag.frame);
    await page.mouse.up();
    await expect(page.getByTestId('save-status')).toHaveText('保存済み');
    const moved = await request.get(`${api}/gardens/${garden.id}`).then((r) => r.json());
    expect(Math.hypot(moved.objects[0].position.x, moved.objects[0].position.z)).toBeGreaterThan(0.05);
    // Restore the center through the normal inspector, then exercise the custom rotation ring.
    await page.getByTestId('object-details-toggle').click();
    await page.getByTestId('position-x').fill('0'); await page.getByTestId('position-z').fill('0');
    await page.getByTestId('object-details-toggle').click();
    await expect(page.getByTestId('save-status')).toHaveText('保存済み');
    await page.getByTestId('tool-rotate').click();
    const radius = 1.4 * box.height / (2 * 17.94 * Math.tan(21 * Math.PI / 180));
    await page.mouse.move(cx + radius, cy); await page.mouse.down();
    await page.mouse.move(cx, cy + radius, { steps: 12 });
    await expect(page.getByTestId('tool-rotate')).toBeDisabled();
    await page.keyboard.press('Escape'); await page.mouse.up();
    await expect(page.getByTestId('tool-rotate')).toBeEnabled();
    await expect(page.getByTestId('save-status')).toHaveText('保存済み');
    await page.mouse.move(cx + radius, cy); await page.mouse.down();
    const rotateStart = await page.evaluate(() => window.plantRenderSnapshot());
    for (let i = 1; i <= 20; i++) {
      const a = i / 20 * Math.PI / 2; await page.mouse.move(cx + radius * Math.cos(a), cy - radius * Math.sin(a));
    }
    await expect(page.getByTestId('tool-rotate')).toBeDisabled();
    expect((await page.evaluate(() => window.plantRenderSnapshot())).frame).toBeGreaterThan(rotateStart.frame);
    await page.mouse.up(); await expect(page.getByTestId('save-status')).toHaveText('保存済み');
    const stored = await request.get(`${api}/gardens/${garden.id}`).then((r) => r.json());
    expect(Math.abs(stored.objects[0].rotation.y)).toBeCloseTo(Math.PI / 2, 1);
    if (!await page.getByRole('button', { name: '完成イメージを確認', exact: true }).isVisible()) await page.getByRole('button', { name: /^(AI生成|完成イメージ)メニュー$/ }).click();
    await page.getByRole('button', { name: '完成イメージを確認', exact: true }).click();
    const image = page.getByRole('dialog', { name: '庭の完成イメージ' }).locator('img');
    await expect(image).toBeVisible();
    expect(await image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(100);
    await page.keyboard.press('Escape'); await page.reload();
    await page.getByRole('button', { name: '3D庭', exact: true }).click();
    await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 1 / 1');
    expect(await request.get(`${api}/gardens/${garden.id}`).then((r) => r.json())).toEqual(stored);
    await page.screenshot({ path: `${evidence}/reloaded.png` });
    await writeFile(`${evidence}/reloaded.json`, JSON.stringify(stored, null, 2));
    await writeFile(`${evidence}/metrics.json`, JSON.stringify({ idleFrames: idleEnd.frame - idleStart.frame,
      liveDragFrames: duringDrag.frame - beforeDrag.frame, errors }, null, 2));
    expect(errors).toEqual([]);
  } finally { expect((await request.delete(`${api}/gardens/${garden.id}`)).status()).toBe(204); }
});
