import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { plantPresetsV3, referenceProfiles } from './plant-library-v3-presets.mjs';
import { measurePlant, readPlantMeshes } from './measure-plant-model.mjs';
const out = new URL('../artifacts/plant-v4/', import.meta.url); await mkdir(out, { recursive: true });
const old = JSON.parse(await readFile(new URL('../artifacts/plant-v3/compositions.json', import.meta.url), 'utf8'));
const oldMetrics = JSON.parse(await readFile(new URL('../artifacts/plant-v3/measurements.json', import.meta.url), 'utf8'));
const legacyGarden = JSON.parse(await readFile(new URL('../artifacts/plant-combination-audit/garden-before.json', import.meta.url), 'utf8'));
const requests = plantPresetsV3.map((p) => ({ key: p.key, profile: p.profile, version: 4 })), pairs = [];
for (const p of plantPresetsV3.filter((p) => referenceProfiles[p.key])) {
  const values = { leafSizeCm: [p.profile.leafSizeCm * 0.8, p.profile.leafSizeCm * 1.2],
    leafDensity: ['low', 'high'], seed: [111, 222], branchCount: [4, 24] };
  if (['maple', 'goldcrest'].includes(p.profile.botanicalForm)) values.branchAngle = [20, 75];
  if (p.profile.botanicalForm !== 'hakone') values.trunkThicknessCm = [0.5, 2];
  if (p.profile.botanicalForm === 'maple') values.crownShape = ['round', 'spreading'];
  if (p.profile.flowerEnabled) values.flowerSizeCm = [p.profile.flowerSizeCm * 0.8, p.profile.flowerSizeCm * 1.2];
  for (const [field, choices] of Object.entries(values)) {
    const id = `${p.key}/${field}`; pairs.push(id);
    choices.forEach((value, i) => requests.push({ key: `${id}/${i}`, version: 4, profile: { ...p.profile, [field]: value } }));
  }
  requests.push({ key: `repeat/${p.key}`, profile: p.profile, version: 4 });
}
requests.push({ key: 'impossible', version: 4, profile: { ...plantPresetsV3[2].profile, heightCm: 10, widthCm: 10, leafSizeCm: 80 } });
for (const r of old) requests.push({ key: `legacy3/${r.key}`, profile: r.composition.profile, version: 3 });
for (const obj of legacyGarden.objects) if (obj.modelComposition) requests.push({ key: `legacy/${obj.id}`,
  profile: obj.modelComposition.profile, version: obj.modelComposition.version });
const backend = fileURLToPath(new URL('../backend/', import.meta.url));
const run = spawnSync(`${backend}/.venv/Scripts/python.exe`, ['-m', 'verification.resolve_plant_v3'], {
  cwd: backend, input: JSON.stringify(requests), encoding: 'utf8', maxBuffer: 150 * 1024 * 1024 });
if (run.status !== 0) throw new Error(run.stderr);
const all = JSON.parse(run.stdout), byId = new Map(all.map((r) => [r.key, r]));
await writeFile(new URL('resolve-errors.json', out), JSON.stringify(all.filter((r) => r.error), null, 2));
const baseline = plantPresetsV3.map((p) => byId.get(p.key));
await writeFile(new URL('compositions.json', out), JSON.stringify(baseline));
const meshes = await readPlantMeshes(4), measurements = [];
for (const r of all.filter((r) => !r.key.startsWith('legacy') && r.key !== 'impossible')) {
  assert(!r.error, `${r.key}: ${r.error}`);
  const c = r.composition, m = measurePlant(c, meshes);
  assert(Math.abs(m.min[1]) <= 0.001, `${r.key}: ground ${m.min[1]}`);
  assert(m.heightError < 0.005 && m.widthError < 0.005, `${r.key}: dimensions`);
  assert.deepEqual(c.fitScale, [1, 1, 1]);
  for (const part of c.parts.filter((p) => /^(leaf|flower)-/.test(p.partId))) assert(part.scale.every((s) => s === part.scale[0]), `${r.key}: stretched leaf`);
  if (!r.key.includes('/')) {
    if (referenceProfiles[r.key]) assert(m.triangles <= oldMetrics.find((p) => p.key === r.key).triangles, `${r.key}: triangle budget`);
    measurements.push({ key: r.key, parts: c.parts.length, ...m }); console.log(r.key, c.parts.length, m.triangles);
  }
}
for (const id of pairs) assert.notDeepEqual(byId.get(`${id}/0`).composition.parts, byId.get(`${id}/1`).composition.parts, `Inert: ${id}`);
for (const p of plantPresetsV3.filter((p) => referenceProfiles[p.key])) assert.deepEqual(byId.get(`repeat/${p.key}`).composition, byId.get(p.key).composition);
for (const r of old) assert.deepEqual(byId.get(`legacy3/${r.key}`).composition, r.composition, `Changed v3: ${r.key}`);
for (const obj of legacyGarden.objects) if (obj.modelComposition) {
  const expected = structuredClone(obj.modelComposition); expected.profile.botanicalForm ??= null;
  assert.deepEqual(byId.get(`legacy/${obj.id}`).composition, expected);
}
assert(byId.get('impossible').error);
await writeFile(new URL('measurements.json', out), JSON.stringify(measurements, null, 2));
await writeFile(new URL('settings.json', out), JSON.stringify({ changedSettings: pairs, legacySnapshots: old.length + legacyGarden.objects.length,
  deterministic: true, impossibleRejected: true }, null, 2));
console.log(`PASS: ${measurements.length} profiles, ${pairs.length} setting pairs, 40 legacy snapshots, per-species triangle budgets.`);
