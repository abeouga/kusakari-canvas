// A filled texture or bounding box can look split at a distance; ray-test the real triangles.
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { Raycaster, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const version = process.argv.includes('--v4') ? 4 : 3;
const bytes = await readFile(new URL(`../frontend/public/models/plant-parts/v${version}/${version === 4 ? 'leaf-monstera' : 'leaf-split'}.glb`, import.meta.url));
const { scene } = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
scene.updateMatrixWorld(true);
function hits(x, y) { return new Raycaster(new Vector3(x, y, 10), new Vector3(0, 0, -1)).intersectObject(scene, true).length; }
const apertures = [];
for (const sign of [-1, 1]) for (const y of [0.20, 0.38, 0.56]) {
  const x = sign * (0.13 - y * 0.08), count = hits(x, y);
  assert.equal(count, 0, `Filled Monstera hole at ${x},${y}`); apertures.push({ x, y, hits: count });
}
assert(hits(0, 0.75) > 0, 'The lamina must be present between the holes');
assert(hits(0.3, 0.2) > 0, 'The lower leaf lobe must be present');
await writeFile(new URL(`../artifacts/plant-v${version}/leaf-holes.json`, import.meta.url), JSON.stringify({ apertures, laminaPresent: true }, null, 2));
console.log('PASS: six true Monstera leaf apertures and intact lamina.');
