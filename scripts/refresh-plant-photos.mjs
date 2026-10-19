// Update only the 30 already-published library products; retain models and commercial fields.
import assert from 'node:assert/strict';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { plantPresets } from './plant-library-presets.mjs';

const api = 'http://127.0.0.1:8086/api';
const report = new URL('../artifacts/plant-photo-refresh/', import.meta.url);
const imageRoot = new URL('../../kusakari-ec/frontend/public/', import.meta.url);
const permitted = ['storeId', 'sku', 'name', 'latinName', 'category', 'description', 'sizeLabel', 'care',
  'priceYen', 'stock', 'imageUrl', 'badge', 'nurseryName', 'nurseryAddress', 'sunlight', 'useCase',
  'careLevel', 'minTemperatureC', 'heatTolerant', 'droughtTolerant', 'ageYears', 'heightCm',
  'potDiameterCm', 'familyName', 'floweringDescription', 'seasonalCare', 'styleDescription', 'images'];
const changedFields = ['name', 'latinName', 'description', 'imageUrl'];
async function request(path, body) {
  const options = body ? { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {};
  const response = await fetch(api + path, options);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${await response.text()}`);
  return response.json();
}
await mkdir(report, { recursive: true });
const before = await request('/products?storeId=1');
assert.equal(plantPresets.length, 30);
// Validate all targets and files before the first write.
for (const preset of plantPresets) {
  const matches = before.filter((product) => product.sku === preset.sku);
  assert.equal(matches.length, 1, `Unique existing product required: ${preset.sku}`);
  assert.ok([preset.legacyName, preset.name].includes(matches[0].name), `Unexpected edited name: ${preset.sku}`);
  assert.equal(matches[0].modelComposition?.version, 2);
  assert.deepEqual(matches[0].plantModelProfile, preset.profile);
  await access(new URL(preset.imageUrl.slice(1), imageRoot));
}
// Exclusive backup: never overwrite the first pre-update snapshot on retry.
try { await writeFile(new URL('before.json', report), JSON.stringify(before, null, 2), { flag: 'wx' }); }
catch (error) { if (error.code !== 'EEXIST') throw error; }
const updated = [];
for (const preset of plantPresets) {
  const existing = before.find((product) => product.sku === preset.sku);
  const body = Object.fromEntries(permitted.map((field) => [field, existing[field]]));
  body.storeId = 1; // ProductView omits storeId; targets were fetched from this store.
  for (const field of changedFields) body[field] = preset[field];
  // Omit plantModelProfile: the API preserves the current model without regeneration.
  const product = await request(`/products/${existing.id}`, body);
  updated.push(product);
  await writeFile(new URL('progress.json', report), JSON.stringify(updated, null, 2));
}
const after = await request('/products?storeId=1');
assert.equal(after.length, before.length, 'No products created/deleted');
for (const previous of before) {
  const current = after.find((product) => product.id === previous.id);
  const preset = plantPresets.find((entry) => entry.sku === previous.sku);
  if (!preset) { assert.deepEqual(current, previous, `Unrelated product changed: ${previous.id}`); continue; }
  for (const [field, value] of Object.entries(previous)) {
    if (changedFields.includes(field)) assert.deepEqual(current[field], preset[field]);
    else if (field !== 'sourceUpdatedAt') assert.deepEqual(current[field], value, `Unexpected change: ${previous.id}/${field}`);
  }
}
await writeFile(new URL('after.json', report), JSON.stringify(after, null, 2));
await writeFile(new URL('registered.json', report), JSON.stringify(updated, null, 2));
const original = JSON.parse(await readFile(new URL('before.json', report), 'utf8'));
await writeFile(new URL('summary.json', report), JSON.stringify({ updated: updated.length, totalProducts: after.length,
  unchangedOtherProducts: before.length - updated.length, modelsPricesStockPreserved: true,
  changedFields, originalBackupProducts: original.length, generatedImages: 30 }, null, 2));
console.log('Updated 30 names/descriptions/photos; prices, stock, models and other products preserved.');
