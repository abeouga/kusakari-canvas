// Publish only this library to the user's local EC through its ordinary product API.
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { plantPresets, productInput } from './plant-library-presets.mjs';

const base = 'http://127.0.0.1:8086/api';
const evidence = fileURLToPath(new URL('../artifacts/e2e/plant-library-v2/', import.meta.url));
const destination = fileURLToPath(new URL('../../kusakari-ec/frontend/public/images/', import.meta.url));
const report = fileURLToPath(new URL('../artifacts/plant-library-publication/', import.meta.url));
const metrics = JSON.parse(await readFile(`${evidence}/metrics.json`, 'utf8'));
const verified = JSON.parse(await readFile(`${evidence}/products.json`, 'utf8'));
if (metrics.productCount !== 30 || metrics.pageErrors.length) throw new Error('Validated library evidence required');
for (const preset of plantPresets) {
  const response = await fetch('http://127.0.0.1:8080/api/model-assemblies/resolve', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(preset.profile) });
  if (!response.ok) throw new Error(`Current Canvas cannot resolve ${preset.key}`);
  assert.deepEqual(await response.json(), verified.find((product) => product.name === preset.name || product.name === preset.legacyName)?.modelComposition,
    `Current Canvas differs from validated model: ${preset.key}`);
}
async function request(path, body) {
  const response = await fetch(base + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  if (!response.ok) throw new Error(`EC request ${path}: HTTP ${response.status}`);
  return response.json();
}
await mkdir(report, { recursive: true });
const before = await request('/products?storeId=1');
await writeFile(`${report}/before.json`, JSON.stringify(before, null, 2));
const registered = [];
for (const preset of plantPresets) {
  const existing = before.find((product) => product.sku === preset.sku);
  if (existing) {
    if (existing.name !== preset.name || existing.modelComposition?.version !== 2
        || JSON.stringify(existing.plantModelProfile) !== JSON.stringify(preset.profile)) {
      // JSON member order can differ: compare field values before rejecting a same-library retry.
      const matches = existing.name === preset.name && existing.modelComposition?.version === 2
        && Object.entries(preset.profile).every(([key, value]) => existing.plantModelProfile?.[key] === value);
      if (!matches) throw new Error(`Existing SKU differs; retained without changes: ${preset.sku}`);
    }
    registered.push(existing); continue;
  }
  const imageUrl = preset.imageUrl;
  await access(`${destination}/${imageUrl.split('/').pop()}`);
  const product = await request('/products', productInput(preset, imageUrl));
  if (product.modelComposition?.version !== 2) throw new Error(`Unexpected model version: ${preset.sku}`);
  registered.push(product);
  await writeFile(`${report}/registered.json`, JSON.stringify(registered, null, 2));
}
const after = await request('/products?storeId=1');
for (const old of before) {
  if (JSON.stringify(after.find((product) => product.id === old.id)) !== JSON.stringify(old)) {
    throw new Error(`Existing product changed: ${old.id}`);
  }
}
for (const product of registered) {
  if (!after.some((current) => current.id === product.id && current.modelComposition?.version === 2)) throw new Error('Product read-back failed');
}
await writeFile(`${report}/registered.json`, JSON.stringify(registered, null, 2));
await writeFile(`${report}/summary.json`, JSON.stringify({ registered: registered.length, before: before.length,
  after: after.length, existingProductsUnchanged: true, ids: registered.map((product) => product.id) }, null, 2));
console.log(`Verified ${registered.length} products in the local EC; previous products unchanged.`);
