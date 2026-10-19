import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { plantPresetsV3 } from './plant-library-v3-presets.mjs';
import assert from 'node:assert/strict';
import { measurePlant, readPlantMeshes } from './measure-plant-model.mjs';
const backend = fileURLToPath(new URL('../backend/', import.meta.url));
const run = spawnSync(`${backend}/.venv/Scripts/python.exe`, ['-m', 'verification.resolve_plant_v3'], {
  cwd: backend, input: JSON.stringify(plantPresetsV3.map((p) => ({ key: p.key, profile: p.profile }))),
  encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
if (run.status !== 0) throw new Error(run.stderr);
const results = JSON.parse(run.stdout), out = new URL('../artifacts/plant-v3/', import.meta.url);
await mkdir(out, { recursive: true });
await writeFile(new URL('compositions.json', out), JSON.stringify(results));
for (const r of results) console.log(r.key, r.error || `${r.composition.parts.length} parts; ${r.seconds.toFixed(2)}s`);
assert(!results.some((r) => r.error), 'All 30 profiles must resolve');
const meshes = await readPlantMeshes(3), measurements = [];
for (const r of results) {
  const c = r.composition, actual = measurePlant(c, meshes);
  assert(Math.abs(actual.min[1]) <= 0.001, `${r.key} ground ${actual.min[1]}`);
  assert(actual.heightError < 0.005 && actual.widthError < 0.005, `${r.key} dimensions`);
  for (const part of c.parts.filter((p) => p.partId.startsWith('leaf-') || p.partId.startsWith('flower-')))
    assert(part.scale.every((v) => v === part.scale[0]), `${r.key} distorted ${part.partId}`);
  assert.deepEqual(c.fitScale, [1, 1, 1]);
  assert(Math.abs(c.baseDimensions.width - actual.size[0]) < 0.0001);
  assert(Math.abs(c.baseDimensions.depth - actual.size[2]) < 0.0001);
  measurements.push({ key: r.key, ...actual });
}
await writeFile(new URL('measurements.json', out), JSON.stringify(measurements, null, 2));
console.log(`PASS: ${measurements.length} actual meshes grounded, dimensioned, and without leaf distortion.`);
