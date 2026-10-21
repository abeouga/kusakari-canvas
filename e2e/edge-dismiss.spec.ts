import { randomUUID } from 'node:crypto';
import { expect, test, type Locator } from '@playwright/test';
import { api } from './api-url.js';
import type { GardenDocument } from '../frontend/src/types/garden.js';

for (const touch of [false, true]) {
  test.describe(touch ? 'タッチ' : 'マウス', () => {
    test.use({ hasTouch: touch, viewport: touch ? { width: 390, height: 844 } : { width: 1440, height: 960 } });

    test('実寸入力の外側操作・未適用値破棄・MySQL保存復元', async ({ page, request }, testInfo) => {
      const press = async (target: Locator) => {
        if (touch) await target.tap();
        else await target.click();
      };
      const created = await request.post(`${api}/gardens`, { data: { name: `外側操作 ${randomUUID()}` } });
      expect(created.status()).toBe(201);
      const initial = await created.json() as GardenDocument;
      await page.goto(`/gardens/${initial.id}`);
      const dataUrl = await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 1000; canvas.height = 750;
        const context = canvas.getContext('2d')!;
        context.fillStyle = '#8b9c72';
        context.fillRect(0, 0, 1000, 750);
        return canvas.toDataURL('image/png');
      });
      // Leave the right edge exposed beside the 280 px panel even at mobile width.
      const boundary = [{ x: .05, y: .8 }, { x: .95, y: .8 }, { x: .95, y: .2 }, { x: .05, y: .2 }];
      const seeded = await request.put(`${api}/gardens/${initial.id}`, { data: {
        ...initial, width: 10, depth: 8,
        photo: { dataUrl, imageWidth: 1000, imageHeight: 750, boundary, corners: boundary },
      } });
      expect(seeded.status(), await seeded.text()).toBe(200);
      const before = await seeded.json() as GardenDocument;
      await page.reload();
      await expect(page.getByTestId('save-status')).toHaveText('保存済み');
      const outlineMode = page.getByRole('button', { name: '輪郭と寸法' });
      await press(outlineMode);
      const writes: string[] = [];
      page.on('request', (event) => {
        if (event.method() === 'PUT' && new URL(event.url()).pathname === `/api/gardens/${initial.id}`) writes.push(event.url());
      });
      const popup = page.getByRole('dialog', { name: '選択した辺の長さ' });
      const field = popup.getByLabel('辺の長さ（m）');
      const edge = page.getByTestId('photo-edge-0');
      // A non-interactive caption outside the photo also exercises document-wide dismissal.
      const outside = page.getByTestId('save-status');
      await press(edge);
      await expect(field).toBeFocused();
      const originalValue = await field.inputValue();
      await press(field);
      await expect(popup).toBeVisible();
      for (const value of ['12.5', 'abc']) {
        await field.fill(value);
        await press(outside);
        await expect(popup).toBeHidden();
        await press(edge);
        await expect(field).toHaveValue(originalValue);
      }
      // Photo margin is outside the panel and the construction boundary.
      await field.fill('13');
      const stage = page.locator('svg.photo-stage');
      await stage.scrollIntoViewIfNeeded();
      const margin = await stage.evaluate(node => {
        const p = new DOMPoint(30, 30).matrixTransform((node as SVGSVGElement).getScreenCTM()!);
        return { x: p.x, y: p.y };
      });
      if (touch) await page.touchscreen.tap(margin.x, margin.y);
      else await page.mouse.click(margin.x, margin.y);
      await expect(popup).toBeHidden();

      await press(edge);
      await field.fill('14');
      await press(page.getByTestId('photo-edge-1'));
      await expect(popup.getByRole('heading')).toHaveText('辺2の長さ');
      await expect(field).toBeFocused();
      await expect(field).not.toHaveValue('14');
      const ground = page.getByRole('checkbox', { name: '地面', exact: true });
      await expect(ground).toBeChecked();
      await press(ground);
      await expect(popup).toBeHidden();
      await expect(ground).not.toBeChecked();
      await expect(page.getByTestId('photo-ground')).toHaveCount(0);
      if (!touch) await expect(ground).toBeFocused();
      await press(ground);

      for (const method of ['辺の計測を閉じる', 'Escape']) {
        await press(edge);
        await field.fill('15');
        if (method === 'Escape') await field.press('Escape');
        else await press(popup.getByRole('button', { name: method, exact: true }));
        await expect(popup).toBeHidden();
        await expect(edge).toBeFocused();
      }
      // Observe beyond the 500 ms autosave debounce; no edit should be queued.
      await page.waitForTimeout(1100);
      expect(writes).toEqual([]);
      const unchangedResponse = await request.get(`${api}/gardens/${initial.id}`);
      expect(unchangedResponse.status()).toBe(200);
      const unchanged = await unchangedResponse.json();
      expect(unchanged).toEqual(before);
      await page.reload();
      await press(outlineMode);
      await press(edge);
      await expect(field).toHaveValue(originalValue);
      await page.screenshot({ path: testInfo.outputPath('discard-reloaded.png'), fullPage: true });

      await field.fill('abc');
      await press(popup.getByRole('button', { name: '長さを適用' }));
      await expect(popup.getByRole('alert')).toBeVisible();
      await expect(popup).toBeVisible();
      await press(outside);
      await expect(popup).toBeHidden();
      await press(edge);
      await field.fill('12.5');
      const saved = page.waitForResponse(response =>
        response.request().method() === 'PUT' && new URL(response.url()).pathname === `/api/gardens/${initial.id}`);
      await press(popup.getByRole('button', { name: '長さを適用' }));
      await expect(popup).toBeVisible();
      await press(outside);
      await expect(popup).toBeHidden();
      expect((await saved).status()).toBe(200);
      await expect(page.getByTestId('save-status')).toHaveText('保存済み');
      const afterResponse = await request.get(`${api}/gardens/${initial.id}`);
      expect(afterResponse.status()).toBe(200);
      const after = await afterResponse.json() as GardenDocument;
      // Only the entered edge is recorded; the garden size and camera wait for the remaining edges.
      expect(after.photo!.edgeLengths).toEqual([12.5, null, null, null]);
      expect(after.width).toBe(before.width);
      expect(after.depth).toBe(before.depth);
      expect(after.photo!.calibration).toBeUndefined();
      expect(after.photo!.boundary).toEqual(before.photo!.boundary);
      expect(after.revision).toBeGreaterThan(before.revision);
      await page.reload();
      await press(outlineMode);
      await press(edge);
      await expect(page.getByTestId('edge-measurement')).toHaveText('12.50 m');
      await expect(field).toHaveValue('12.5');
      await page.screenshot({ path: testInfo.outputPath('applied-reloaded.png'), fullPage: true });
      await testInfo.attach('garden-api-json', {
        body: JSON.stringify({ before, unchanged, after }, null, 2), contentType: 'application/json',
      });
      // Keep this uniquely named E2E garden for evidence; never delete other gardens.
    });
  });
}
