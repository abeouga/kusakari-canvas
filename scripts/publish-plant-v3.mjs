// Explicitly scoped migration requested by the user. No creates, deletes, or unrelated garden writes.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { plantPresetsV3, referenceProfiles } from './plant-library-v3-presets.mjs';
import { measurePlant, readPlantMeshes } from './measure-plant-model.mjs';

const canvas = 'http://127.0.0.1:8080/api', ec = 'http://127.0.0.1:8086/api';
const gardenId = process.argv.find((arg) => arg.startsWith('--garden='))?.slice('--garden='.length);
assert(gardenId && /^[0-9a-f-]{36}$/.test(gardenId), 'Specify the user-approved garden with --garden=<UUID>');
const apply = process.argv.includes('--apply');
const output = new URL(`../artifacts/plant-v3/publication/${new Date().toISOString().replaceAll(':', '-')}/`, import.meta.url);
await mkdir(output, { recursive: true });
const save = (name, value) => writeFile(new URL(name, output), JSON.stringify(value, null, 2), { flag: 'wx' });
async function api(url, data) {
  const response = await fetch(url, data === undefined ? {} : { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  if (!response.ok) throw new Error(`${response.status} ${url}: ${await response.text()}`);
  return response.json();
}
async function resolve(profile) {
  const response = await fetch(`${canvas}/model-assemblies/resolve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile) });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
const meshes = await readPlantMeshes(3);
function verify(model) {
  assert.equal(model.version, 3); assert.equal(model.catalogVersion, 3);
  assert.deepEqual(model.fitScale, [1, 1, 1]);
  const m = measurePlant(model, meshes);
  assert(Math.abs(m.min[1]) <= 0.001 && m.heightError < 0.005 && m.widthError < 0.005);
  return m;
}
const omit = (object, keys) => Object.fromEntries(Object.entries(object).filter(([key]) => !keys.includes(key)));
const unchangedProduct = (product) => omit(product, ['plantModelProfile', 'modelComposition']);
const unchangedObject = (object) => omit(object, ['modelComposition']);
const writable = ['sku', 'name', 'latinName', 'category', 'description', 'sizeLabel', 'care', 'priceYen', 'stock',
  'imageUrl', 'badge', 'nurseryName', 'nurseryAddress', 'sunlight', 'useCase', 'careLevel', 'minTemperatureC',
  'heatTolerant', 'droughtTolerant', 'ageYears', 'heightCm', 'potDiameterCm', 'familyName', 'floweringDescription',
  'seasonalCare', 'styleDescription', 'images'];
const stores = await api(`${ec}/stores`), catalogs = [];
for (const store of stores) catalogs.push({ storeId: store.id, products: await api(`${ec}/products?storeId=${store.id}`) });
const products = catalogs.find((c) => c.storeId === 1).products;
const beforeGarden = await api(`${canvas}/gardens/${gardenId}`), otherGardens = (await api(`${canvas}/gardens`)).filter((g) => g.id !== gardenId);
await save('products-before.json', catalogs); await save('garden-before.json', beforeGarden);
await save('other-gardens-before.json', otherGardens);
const plan = [], byProduct = new Map();
for (const preset of plantPresetsV3) {
  const matches = products.filter((p) => p.sku === preset.sku);
  assert.equal(matches.length, 1, `Exact existing SKU required: ${preset.sku}`);
  const before = matches[0]; assert(before.plantModelProfile);
  const profile = { ...before.plantModelProfile, botanicalForm: null, ...referenceProfiles[preset.key] };
  assert.equal(profile.heightCm, before.heightCm);
  assert.equal(profile.widthCm, before.plantModelProfile.widthCm);
  const composition = await resolve(profile), measurement = verify(composition);
  plan.push({ key: preset.key, before, profile, composition, measurement }); byProduct.set(before.id, composition);
}
const updatedGarden = structuredClone(beforeGarden), gardenMeasurements = [];
for (const object of updatedGarden.objects) {
  if (!object.modelComposition) continue;
  const before = object.modelComposition;
  object.modelComposition = byProduct.get(object.productId) ?? await resolve(before.profile);
  assert.equal(object.modelComposition.profile.heightCm, before.profile.heightCm);
  assert.equal(object.modelComposition.profile.widthCm, before.profile.widthCm);
  gardenMeasurements.push({ id: object.id, ...verify(object.modelComposition) });
}
assert.deepEqual(updatedGarden.objects.map(unchangedObject), beforeGarden.objects.map(unchangedObject));
await save('plan.json', { apply, gardenId, products: plan.map((p) => ({ key: p.key, id: p.before.id, profile: p.profile, measurement: p.measurement })), gardenMeasurements });
console.log(`Preflight passed: ${plan.length} products, ${gardenMeasurements.length} garden plants. Backup: ${output.pathname}`);
if (!apply) process.exit(0);
const completed = [];
try {
  for (const row of plan) {
    const fresh = (await api(`${ec}/products?storeId=1`)).find((p) => p.id === row.before.id);
    assert.deepEqual(fresh, row.before, 'Product changed during migration; stop instead of overwriting');
    const body = { ...Object.fromEntries(writable.map((key) => [key, fresh[key]])), storeId: 1, plantModelProfile: row.profile };
    const updated = await api(`${ec}/products/${fresh.id}`, body);
    assert.deepEqual(unchangedProduct(updated), unchangedProduct(row.before));
    assert.deepEqual(updated.modelComposition, row.composition); verify(updated.modelComposition);
    completed.push(updated.id); console.log(`Updated ${row.key}`);
  }
  // Revision comparison and server-side optimistic locking both protect concurrent garden edits.
  assert.deepEqual(await api(`${canvas}/gardens/${gardenId}`), beforeGarden, 'Garden changed during migration');
  const saved = await api(`${canvas}/gardens/${gardenId}`, updatedGarden);
  assert.deepEqual(saved.objects.map(unchangedObject), beforeGarden.objects.map(unchangedObject));
  assert.deepEqual(saved.objects, updatedGarden.objects);
  assert.deepEqual(await api(`${canvas}/gardens/${gardenId}`), saved);
  await save('garden-after.json', saved);
  for (const catalog of catalogs) {
    const after = await api(`${ec}/products?storeId=${catalog.storeId}`);
    assert.equal(after.length, catalog.products.length);
    for (const before of catalog.products) {
      const now = after.find((p) => p.id === before.id); assert(now);
      if (byProduct.has(before.id)) assert.deepEqual(unchangedProduct(now), unchangedProduct(before));
      else assert.deepEqual(now, before, `Unrelated product changed: ${before.id}`);
    }
    await save(`store-${catalog.storeId}-after.json`, after);
  }
  assert.deepEqual((await api(`${canvas}/gardens`)).filter((g) => g.id !== gardenId), otherGardens);
  await save('result.json', { completed: true, products: completed.length, gardenPlants: gardenMeasurements.length,
    revisionBefore: beforeGarden.revision, revisionAfter: saved.revision, transformsPreserved: true,
    allStoresCommerceMetadataPreserved: true, unrelatedProductsAndGardensPreserved: true });
  console.log(`PASS: published ${completed.length}; migrated garden revision ${beforeGarden.revision} -> ${saved.revision}.`);
} catch (error) {
  await save('failure.json', { completedProductIds: completed, message: error.message }); throw error;
}
