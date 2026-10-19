// Read-only rendered references for visual review. Never copied into product assets.
import { chromium, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = '1';
const references = [
  ['maple', 'https://plants.ces.ncsu.edu/plants/acer-palmatum/', 'img[alt="Red fall leaves and red samaras (Cabarrus County, NC)"]'],
  ['goldcrest', 'https://plants.ces.ncsu.edu/plants/hesperocyparis-macrocarpa-goldcrest/', 'img[alt="Conical conifer with chartreuse foliage."]'],
  ['iberis', 'https://plantdatabase.kpu.ca/Plant/ibse', 'img[src*="ibseh1.jpg"]'],
  ['monstera', 'https://hort.extension.wisc.edu/articles/monstera-deliciosa/', 'img[src*="monstera-houseplant.jpg"]'],
  ['hakone', 'https://hort.extension.wisc.edu/articles/japanese-forest-grass-hakonechloa-macra/', 'img[src*="Hakonechloa-1.jpg"]'],
];
const browser = await chromium.launch({ channel: 'chromium' }), result = [];
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  for (const [key, url, selector] of references) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      const photo = page.locator(selector).first();
      await photo.waitFor({ state: 'attached', timeout: 15000 });
      await photo.evaluate(async (img) => { await img.decode(); });
      const info = await photo.evaluate((img) => ({ alt: img.alt, width: img.naturalWidth, url: img.src }));
      if (info.width < 200) throw new Error('Reference photo too small or not loaded');
      await page.goto(info.url, { waitUntil: 'load', timeout: 20000 });
      await expect(page.locator('img')).toBeVisible();
      await page.screenshot({ path: `artifacts/plant-v3/reference-${key}.png` });
      result.push({ key, source: url, alt: info.alt, width: info.width, captured: true });
      console.log(key, 'captured', info.width);
    } catch (error) { result.push({ key, source: url, captured: false, error: error.message }); console.error(key, error.message); }
  }
  await writeFile('artifacts/plant-v3/references.json', JSON.stringify(result, null, 2));
} finally { await browser.close(); }
