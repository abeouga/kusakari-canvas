// User-approved five products and corresponding current-garden objects only.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { plantPresetsV3, referenceProfiles } from './plant-library-v3-presets.mjs';
import { measurePlant, readPlantMeshes } from './measure-plant-model.mjs';
const canvas = 'http://127.0.0.1:8080/api', ec = 'http://127.0.0.1:8086/api';
const gardenId = process.argv.find((arg) => arg.startsWith('--garden='))?.slice('--garden='.length);
assert(gardenId && /^[0-9a-f-]{36}$/.test(gardenId), 'Specify the user-approved garden UUID');
const apply = process.argv.includes('--apply');
const out = new URL(`../artifacts/plant-v4/publication/${new Date().toISOString().replaceAll(':', '-')}/`, import.meta.url);
await mkdir(out, { recursive: true });
const save = (name, value) => writeFile(new URL(name, out), JSON.stringify(value, null, 2), { flag: 'wx' });
async function api(url, data, method = 'PUT') {
  const response = await fetch(url, data === undefined ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  if (!response.ok) throw new Error(`${response.status} ${url}: ${await response.text()}`);
  return response.json();
}
const resolve = (profile) => api(`${canvas}/model-assemblies/resolve?version=4`, profile, 'POST');
const meshes = await readPlantMeshes(4);
function verify(model) {
  assert.equal(model.version, 4); assert.equal(model.catalogVersion, 4); assert.deepEqual(model.fitScale, [1, 1, 1]);
  const m = measurePlant(model, meshes);
  assert(Math.abs(m.min[1]) <= 0.001 && m.heightError < 0.005 && m.widthError < 0.005);
  return m;
}
const omit = (object, keys) => Object.fromEntries(Object.entries(object).filter(([key]) => !keys.includes(key)));
const unchangedProduct = (product) => omit(product, ['modelComposition']);
const unchangedObject = (object) => omit(object, ['modelComposition']);
const writable = ['sku', 'name', 'latinName', 'category', 'description', 'sizeLabel', 'care', 'priceYen', 'stock',
  'imageUrl', 'badge', 'nurseryName', 'nurseryAddress', 'sunlight', 'useCase', 'careLevel', 'minTemperatureC',
  'heatTolerant', 'droughtTolerant', 'ageYears', 'heightCm', 'potDiameterCm', 'familyName', 'floweringDescription',
  'seasonalCare', 'styleDescription', 'images'];
const catalogs = [];
for (const store of await api(`${ec}/stores`)) catalogs.push({ storeId: store.id, products: await api(`${ec}/products?storeId=${store.id}`) });
const products = catalogs.find((c) => c.storeId === 1).products;
const beforeGarden = await api(`${canvas}/gardens/${gardenId}`);
const others = (await api(`${canvas}/gardens`)).filter((g) => g.id !== gardenId);
await save('products-before.json', catalogs); await save('garden-before.json', beforeGarden); await save('other-gardens-before.json', others);
const plan = [], byProduct = new Map();
for (const preset of plantPresetsV3.filter((p) => referenceProfiles[p.key])) {
  const matches = products.filter((p) => p.sku === preset.sku); assert.equal(matches.length, 1);
  const before = matches[0], profile = before.plantModelProfile;
  assert.equal(profile.botanicalForm, referenceProfiles[preset.key].botanicalForm);
  assert.equal(profile.heightCm, before.heightCm);
  const composition = await resolve(profile), measurement = verify(composition);
  plan.push({ key: preset.key, before, profile, composition, measurement }); byProduct.set(before.id, composition);
}
const nextGarden = structuredClone(beforeGarden), changedObjects = [];
for (const object of nextGarden.objects) {
  if (!byProduct.has(object.productId) || !object.modelComposition) continue;
  const old = object.modelComposition;
  // Preserve any saved plant-specific profile, not just the object's placement transform.
  const model = await resolve(old.profile); verify(model); assert.deepEqual(model.profile, old.profile);
  object.modelComposition = model; changedObjects.push(object.id);
}
assert.deepEqual(nextGarden.objects.map(unchangedObject), beforeGarden.objects.map(unchangedObject));
await save('plan.json', { apply, gardenId, changedObjects, products: plan.map((p) => ({ id: p.before.id, key: p.key, measurement: p.measurement })) });
console.log(`Preflight: ${plan.length} products; ${changedObjects.length}/${beforeGarden.objects.length} garden plants. Backup: ${out.pathname}`);
if (!apply) process.exit(0);
const completed = [];
try {
  for (const row of plan) {
    const fresh = (await api(`${ec}/products?storeId=1`)).find((p) => p.id === row.before.id);
    assert.deepEqual(fresh, row.before, 'Product changed concurrently; stopped');
    const body = { ...Object.fromEntries(writable.map((key) => [key, fresh[key]])), storeId: 1, plantModelProfile: row.profile };
    const updated = await api(`${ec}/products/${fresh.id}`, body);
    assert.deepEqual(unchangedProduct(updated), unchangedProduct(row.before));
    assert.deepEqual(updated.modelComposition, row.composition); completed.push(updated.id);
  }
  assert.deepEqual(await api(`${canvas}/gardens/${gardenId}`), beforeGarden, 'Garden changed concurrently; stopped');
  const saved = await api(`${canvas}/gardens/${gardenId}`, nextGarden);
  assert.deepEqual(saved.objects, nextGarden.objects);
  assert.deepEqual(saved.objects.map(unchangedObject), beforeGarden.objects.map(unchangedObject));
  assert.deepEqual(await api(`${canvas}/gardens/${gardenId}`), saved);
  await save('garden-after.json', saved);
  for (const catalog of catalogs) {
    const after = await api(`${ec}/products?storeId=${catalog.storeId}`); assert.equal(after.length, catalog.products.length);
    for (const before of catalog.products) {
      const now = after.find((p) => p.id === before.id); assert(now);
      if (byProduct.has(before.id)) assert.deepEqual(unchangedProduct(now), unchangedProduct(before));
      else assert.deepEqual(now, before, `Unrelated product ${before.id}`);
    }
    await save(`store-${catalog.storeId}-after.json`, after);
  }
  assert.deepEqual((await api(`${canvas}/gardens`)).filter((g) => g.id !== gardenId), others);
  await save('result.json', { completed: true, products: completed.length, updatedGardenPlants: changedObjects.length,
    gardenPlants: saved.objects.length, revisionBefore: beforeGarden.revision, revisionAfter: saved.revision,
    profilesAndTransformsPreserved: true, allStoresCommerceMetadataPreserved: true, unrelatedProductsAndGardensPreserved: true });
  console.log(`PASS: ${completed.length} products; garden ${beforeGarden.revision} -> ${saved.revision}; unchanged placements.`);
} catch (error) { await save('failure.json', { completedProductIds: completed, message: error.message }); throw error; }
