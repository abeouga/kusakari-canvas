import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { plantPresetsV3, referenceProfiles } from './plant-library-v3-presets.mjs';
import { measurePlant, readPlantMeshes } from './measure-plant-model.mjs';
const selected = new Map(plantPresetsV3.map((p) => [p.profile.plantType, p]));
for (const p of plantPresetsV3.filter((p) => referenceProfiles[p.key])) selected.set(p.key, p);
const pairs = [], requests = [];
for (const [key, p] of selected) {
  const values = { leafSizeCm: [p.profile.leafSizeCm * 0.8, p.profile.leafSizeCm * 1.2], leafDensity: ['low', 'high'], seed: [111, 222], branchCount: [4, 20] };
  if (['tree', 'conifer', 'multistem'].includes(p.profile.plantType)) values.branchAngle = [20, 75];
  if (!['conifer', 'grass', 'rosette', 'palm', 'vine'].includes(p.profile.plantType)
      && !['monstera', 'iberis'].includes(p.profile.botanicalForm)) values.crownShape = ['round', 'spreading'];
  if (!['grass', 'rosette'].includes(p.profile.plantType)) values.trunkThicknessCm = [0.5, 2];
  for (const [field, choices] of Object.entries(values)) {
    const id = `${key}/${field}`; pairs.push(id);
    for (const [i, value] of choices.entries()) requests.push({ key: `${id}/${i}`, profile: { ...p.profile, [field]: value } });
  }
}
requests.push({ key: 'impossible', profile: { ...plantPresetsV3[0].profile, heightCm: 10, widthCm: 10, leafSizeCm: 80 } });
const baseline = plantPresetsV3.find((p) => p.key === 'split-leaf');
requests.push({ key: 'deterministic/0', profile: baseline.profile }, { key: 'deterministic/1', profile: baseline.profile });
const garden = JSON.parse(await readFile(new URL('../artifacts/plant-combination-audit/garden-before.json', import.meta.url), 'utf8'));
for (const obj of garden.objects) if (obj.modelComposition) requests.push({ key: `legacy/${obj.id}`,
  profile: obj.modelComposition.profile, version: obj.modelComposition.version });
const backend = fileURLToPath(new URL('../backend/', import.meta.url));
const run = spawnSync(`${backend}/.venv/Scripts/python.exe`, ['-m', 'verification.resolve_plant_v3'],
  { cwd: backend, input: JSON.stringify(requests), encoding: 'utf8', maxBuffer: 150 * 1024 * 1024 });
if (run.status !== 0) throw new Error(run.stderr);
const results = JSON.parse(run.stdout), byId = new Map(results.map((r) => [r.key, r]));
await writeFile(new URL('../artifacts/plant-v3/setting-resolve-errors.json', import.meta.url),
  JSON.stringify(results.filter((r) => r.error).map(({ key, error }) => ({ key, error })), null, 2));
const geometry = (r) => JSON.stringify({ parts: r.composition.parts, fit: r.composition.fitScale });
const meshes = await readPlantMeshes(3), report = [];
for (const id of pairs) {
  const a = byId.get(`${id}/0`), b = byId.get(`${id}/1`);
  assert(!a.error && !b.error, `${id}: ${a.error || b.error}`);
  assert.notEqual(geometry(a), geometry(b), `Inert setting: ${id}`);
  for (const r of [a, b]) {
    const m = measurePlant(r.composition, meshes);
    assert(Math.abs(m.min[1]) < 0.001 && m.heightError < 0.005 && m.widthError < 0.005, `Geometry error: ${r.key}`);
  }
  report.push({ setting: id, changed: true });
}
assert(byId.get('impossible').error, 'Impossible dimensions must reject, never stretch');
assert.equal(geometry(byId.get('deterministic/0')), geometry(byId.get('deterministic/1')));
for (const obj of garden.objects) if (obj.modelComposition) {
  const expected = structuredClone(obj.modelComposition); expected.profile.botanicalForm ??= null;
  assert.deepEqual(byId.get(`legacy/${obj.id}`).composition, expected, `Legacy snapshot changed: ${obj.id}`);
}
await writeFile(new URL('../artifacts/plant-v3/settings.json', import.meta.url), JSON.stringify({ cases: report,
  legacySnapshotsPreserved: garden.objects.length, deterministic: true, impossibleRejected: true }, null, 2));
console.log(`PASS: ${report.length} effective settings, deterministic output, legacy snapshots, impossible dimensions.`);
