import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { plantPresetsV3, referenceProfiles } from './plant-library-v3-presets.mjs';
process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = '1';
const output = fileURLToPath(new URL('../artifacts/plant-v3/visual/', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 850 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  for (const p of plantPresetsV3.filter((p) => referenceProfiles[p.key])) {
    await page.goto(`http://127.0.0.1:5173/model-preview?profile=${encodeURIComponent(JSON.stringify(p.profile))}`);
    await expect(page.getByTestId('preview-loaded')).toHaveText('loaded', { timeout: 45000 });
    const canvas = page.locator('canvas'); await canvas.hover(); await page.mouse.wheel(0, -260); await page.waitForTimeout(500);
    await canvas.screenshot({ path: `${output}/${p.key}-front.png` });
    await page.mouse.move(450, 400); await page.mouse.down(); await page.mouse.move(730, 440, { steps: 15 }); await page.mouse.up();
    await page.waitForTimeout(400); await canvas.screenshot({ path: `${output}/${p.key}-side.png` });
    console.log(`Captured ${p.name}`);
  }
  await writeFile(`${output}/errors.json`, JSON.stringify(errors));
  if (errors.length) throw new Error(errors.join('\n'));
} finally { await browser.close(); }
