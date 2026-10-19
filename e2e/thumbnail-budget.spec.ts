import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { api } from './api-url';
import { createScene, openScene, readGarden, syntheticPhoto } from './occlusion-helpers';

test('a detailed photo saves a bounded scene thumbnail through the real API after reload', async ({ page, request }) => {
  const evidence = 'artifacts/e2e/thumbnail-budget';
  await mkdir(evidence, { recursive: true });
  const photo = await syntheticPhoto(page, 640, 400);
  photo.dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 400;
    const context = canvas.getContext('2d')!;
    const image = context.createImageData(640, 400);
    let seed = 123456;
    for (let i = 0; i < image.data.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
        image.data[i + c] = seed & 255;
      }
      image.data[i + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    return canvas.toDataURL('image/png');
  });
  expect(photo.dataUrl.length).toBeGreaterThan(460000);
  const garden = await createScene(request, [], photo, []);
  const url = `/api/gardens/${garden.id}/thumbnail`;
  // Demonstrate the previous payload exceeds the real API limit; no write occurs.
  const oversized = await request.post(`${api}/gardens/${garden.id}/thumbnail`, {
    data: { revision: garden.revision, dataUrl: photo.dataUrl },
  });
  expect(oversized.status()).toBe(413);
  const statuses: number[] = [];
  const sizes: number[] = [];
  page.on('response', response => {
    if (response.url().endsWith(url) && response.request().method() === 'POST') statuses.push(response.status());
  });
  page.on('request', outgoing => {
    if (outgoing.url().endsWith(url) && outgoing.method() === 'POST') sizes.push(Buffer.byteLength(outgoing.postData()!));
  });
  const uploaded = page.waitForResponse(r => r.url().endsWith(url) && r.request().method() === 'POST' && r.status() === 204);
  await openScene(page, garden);
  await uploaded;
  const reuploaded = page.waitForResponse(r => r.url().endsWith(url) && r.request().method() === 'POST' && r.status() === 204);
  await page.reload();
  await reuploaded;
  const thumb = await request.get(`${api}/gardens/${garden.id}/thumbnail`);
  expect(thumb.status()).toBe(200);
  expect(thumb.headers()['x-thumbnail-source']).toBe('scene');
  expect(statuses.every(status => status === 204)).toBe(true);
  expect(sizes.length).toBeGreaterThanOrEqual(2);
  expect(sizes.every(size => size < 460000)).toBe(true);
  const stored = await readGarden(request, garden.id);
  expect(stored).toEqual(garden);
  await writeFile(`${evidence}/garden.json`, JSON.stringify(stored, null, 2));
  await writeFile(`${evidence}/thumbnail.png`, await thumb.body());
  await writeFile(`${evidence}/requests.json`, JSON.stringify({ gardenId: garden.id,
    originalCharacters: photo.dataUrl.length, originalStatus: oversized.status(), sizes, statuses }, null, 2));
  await page.screenshot({ path: `${evidence}/reloaded.png` });
  // Keep this uniquely named fixture in the dedicated E2E database.
});
