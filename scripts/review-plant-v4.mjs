import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { plantPresetsV3, referenceProfiles } from './plant-library-v3-presets.mjs';
process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = '1';
const label = process.argv[2] || 'after';
const output = fileURLToPath(new URL(`../artifacts/plant-v4/${label}/`, import.meta.url));
await mkdir(output, { recursive: true });
await expect.poll(async () => {
  try { return (await fetch('http://127.0.0.1:8080/api/assets')).status; } catch { return 0; }
}, { timeout: 30000 }).toBe(200);
const browser = await chromium.launch({ channel: 'chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 850 } });
  const errors = [], results = []; page.on('pageerror', (e) => errors.push(e.message));
  const cdp = await page.context().newCDPSession(page); await cdp.send('Performance.enable');
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  for (const p of plantPresetsV3.filter((p) => referenceProfiles[p.key] && (!process.argv[3] || p.key === process.argv[3]))) {
    await page.goto(`http://127.0.0.1:5173/model-preview?renderReview&profile=${encodeURIComponent(JSON.stringify(p.profile))}`);
    await expect(page.getByTestId('preview-loaded')).toHaveText('loaded', { timeout: 45000 });
    const canvas = page.locator('canvas'); await canvas.hover(); await page.mouse.wheel(0, -260);
    await page.waitForTimeout(1800);
    const start = await page.evaluate(() => globalThis.plantRenderSnapshot()); const cpuStart = await metrics();
    await page.waitForTimeout(5000);
    const end = await page.evaluate(() => globalThis.plantRenderSnapshot()); const cpuEnd = await metrics();
    await canvas.screenshot({ path: `${output}/${p.key}-front.png` });
    await page.mouse.move(450, 400); await page.mouse.down();
    const activeStart = await page.evaluate(() => globalThis.plantRenderSnapshot());
    await page.mouse.move(730, 440, { steps: 30 }); await page.mouse.up();
    await page.waitForTimeout(1300);
    const activeEnd = await page.evaluate(() => globalThis.plantRenderSnapshot());
    await canvas.screenshot({ path: `${output}/${p.key}-side.png` });
    await canvas.hover();
    for (let tick = 0; tick < 12; tick++) { await page.mouse.wheel(0, -80); await page.waitForTimeout(35); }
    await page.waitForTimeout(1300);
    await canvas.screenshot({ path: `${output}/${p.key}-detail.png` });
    results.push({ key: p.key, ...end, idleFrames: end.frame - start.frame,
      idleTaskSeconds: cpuEnd.TaskDuration - cpuStart.TaskDuration,
      interactionFrames: activeEnd.frame - activeStart.frame });
    console.log(JSON.stringify(results.at(-1)));
  }
  await writeFile(`${output}/metrics.json`, JSON.stringify({ results, errors }, null, 2));
  if (errors.length) throw new Error(errors.join('\n'));
} finally { await browser.close(); }
