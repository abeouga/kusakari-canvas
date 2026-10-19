import { chromium, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = '1';
const directory = process.argv[2] || 'artifacts/plant-library-publication';
const products = JSON.parse(await readFile(`${directory}/registered.json`, 'utf8'));
const browser = await chromium.launch({ channel: 'chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:5186/#plants');
  await page.getByRole('textbox', { name: '植物を検索' }).fill('PLANT-V2-');
  await expect(page.locator('.product-card')).toHaveCount(30);
  const images = [];
  for (const product of products) {
    const card = page.getByTestId(`product-${product.id}`);
    await card.scrollIntoViewIfNeeded();
    await expect(card.locator('.product-name')).toHaveText(product.name);
    await expect(card.locator('img')).toHaveJSProperty('complete', true);
    await expect(card.locator('img')).toHaveAttribute('src', product.imageUrl);
    const width = await card.locator('img').evaluate((image) => image.naturalWidth);
    if (!width) throw new Error(`Image failed: ${product.name}`);
    images.push({ id: product.id, imageLoaded: true });
  }
  await page.getByRole('textbox', { name: '植物を検索' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${directory}/catalog.png` });
  await page.reload();
  await page.getByRole('textbox', { name: '植物を検索' }).fill('PLANT-V2-');
  await expect(page.locator('.product-card')).toHaveCount(30);
  await page.getByRole('textbox', { name: '植物を検索' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${directory}/catalog-after-reload.png` });
  await page.screenshot({ path: `${directory}/catalog-full.png`, fullPage: true });
  await page.locator('.product-grid').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${directory}/product-cards.png` });
  for (const product of products) {
    await page.getByTestId(`product-${product.id}`).locator('.product-photo').click();
    const dialog = page.getByRole('dialog', { name: '植物について' });
    await expect(dialog.locator('.detail-buy-panel h3')).toHaveText(product.name);
    await expect(dialog.locator('.detail-description')).toHaveText(product.description);
    await expect(dialog.locator('.detail-main-image')).toHaveAttribute('src', product.imageUrl);
    await expect(dialog.locator('.detail-main-image')).toHaveJSProperty('complete', true);
    expect(await dialog.locator('.detail-main-image').evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
    if (product.sku === 'PLANT-V2-CLUSTER-SHRUB') await page.screenshot({ path: `${directory}/detail-hydrangea.png` });
    await dialog.getByRole('button', { name: '閉じる', exact: true }).click();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('textbox', { name: '植物を検索' }).fill('PLANT-V2-');
  await page.locator('.product-grid').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${directory}/mobile-cards.png` });
  expect(errors).toEqual([]);
  await writeFile(`${directory}/browser-verification.json`, JSON.stringify({ visibleProducts: 30, reloaded: true,
    detailsVerified: products.length, mobileWidth: 390, images, pageErrors: errors }, null, 2));
  console.log('30 published products and images verified after browser reload.');
} finally { await browser.close(); }
