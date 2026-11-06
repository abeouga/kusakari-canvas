import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test, type Page } from './test.js';
import { createTestProduct } from './catalog-fixture.js';
import { createGardenFromList } from './garden-create.js';
import { readGarden, syntheticPhoto } from './occlusion-helpers.js';

const directory = 'artifacts/e2e/photo-required-placement';
const reason = '庭写真が未アップロードのため配置できません';

async function dragProduct(page: Page, productId: string) {
  await page.getByRole('tab', { name: '商品一覧', exact: true }).click();
  const box = (await page.getByTestId('garden-canvas').locator('canvas').boundingBox())!;
  await page.getByTestId(`browse-${productId}`).hover({ position: { x: 35, y: 35 } });
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
}

async function showTop3d(page: Page) {
  await page.getByRole('button', { name: '3D庭', exact: true }).click();
  await page.getByRole('button', { name: '上から見る', exact: true }).click();
  await page.waitForTimeout(400); // Orbit controls settle after the explicit top-view command.
}

test('写真未アップロードの3D庭はクリック・ドラッグとも配置せず理由を示し、写真と輪郭の確定後は配置できる', async ({ page, request }) => {
  const product = await createTestProduct(request, `E2E写真必須-${Date.now()}`);
  const id = await createGardenFromList(page);
  await expect(page.getByTestId('save-status')).toHaveText('保存済み');
  await showTop3d(page);
  await expect(page.getByTestId('photo-required')).toContainText(reason);

  // Drag from the product list onto the 3D garden.
  await dragProduct(page, product.id);
  await expect(page.getByRole('alert')).toContainText(reason);
  await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 0 / 0');
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: `${directory}/blocked-without-photo.png`, fullPage: true });

  // Click placement with a product chosen on the EC product page.
  await page.goto(`/gardens/${id}?productId=${product.id}`);
  await showTop3d(page);
  await expect(page.getByTestId(`browse-${product.id}`)).toHaveClass(/is-selected/);
  const box = (await page.getByTestId('garden-canvas').locator('canvas').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole('alert')).toContainText(reason);
  await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 0 / 0');
  await expect(page.getByTestId('save-status')).toHaveText('保存済み');
  expect((await readGarden(request, id)).objects).toEqual([]);

  // The notice leads to the photo upload; drawing and confirming the outline enables placement.
  await page.getByTestId('photo-required').getByRole('button', { name: '写真をアップロード', exact: true }).click();
  const photo = await syntheticPhoto(page, 600, 400);
  await page.getByLabel('庭の写真を選択').setInputFiles({ name: 'garden.png', mimeType: 'image/png',
    buffer: Buffer.from(photo.dataUrl.split(',')[1], 'base64') });
  for (const [x, y] of [[.15, .8], [.85, .8], [.8, .2], [.2, .2]]) {
    const point = await page.locator('.photo-stage').evaluate((node, p) => {
      const screen = new DOMPoint(p.x * 600, p.y * 400).matrixTransform((node as SVGSVGElement).getScreenCTM()!);
      return { x: screen.x, y: screen.y };
    }, { x, y });
    await page.mouse.click(point.x, point.y);
  }
  await page.getByRole('button', { name: '始点につないで輪郭を確定', exact: true }).click();
  await expect(page.getByTestId('save-status')).toHaveText('保存済み');
  await showTop3d(page);
  await expect(page.getByTestId('photo-required')).toHaveCount(0);
  await dragProduct(page, product.id);
  await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 1 / 1');
  await expect.poll(async () => (await readGarden(request, id)).objects.length).toBe(1);

  await page.reload();
  await page.getByRole('button', { name: '3D庭', exact: true }).click();
  await expect(page.getByTestId('model-loaded')).toHaveText('読み込み済み: 1 / 1');
  const saved = await readGarden(request, id);
  expect(saved.photo?.dataUrl).toBe(photo.dataUrl);
  expect(saved.objects[0].productId).toBe(product.id);
  await page.screenshot({ path: `${directory}/placed-reloaded.png`, fullPage: true });
  await writeFile(`${directory}/garden.json`, JSON.stringify(saved, null, 2));
});
