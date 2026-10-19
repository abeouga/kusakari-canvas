import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { plantPresets } from './plant-library-presets.mjs';
process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = '1';
const browser = await chromium.launch({ channel: 'chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1800 }, deviceScaleFactor: 1 });
  const cards = [];
  for (const preset of plantPresets) {
    const png = await readFile(`artifacts/e2e/plant-library-v2/${preset.key}.png`);
    cards.push(`<article><img src="data:image/png;base64,${png.toString('base64')}"/><div>${preset.name}</div><small>${preset.profile.heightCm} × ${preset.profile.widthCm} cm</small></article>`);
  }
  await page.setContent(`<html lang="ja"><meta charset="utf-8"><style>body{margin:16px;background:#fff;font-family:Meiryo,sans-serif}main{display:grid;grid-template-columns:repeat(5,1fr);gap:10px}article{border:1px solid #ccd3c6;border-radius:6px;overflow:hidden;text-align:center;padding-bottom:8px;font-size:13px}img{width:100%;height:225px;object-fit:cover}small{color:#666}</style><main>${cards.join('')}</main></html>`);
  await page.screenshot({ path: 'artifacts/e2e/plant-library-v2/contact-sheet.png', fullPage: true });
} finally { await browser.close(); }
