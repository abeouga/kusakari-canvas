import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
const root = 'frontend/public/models/plant-parts/v2';
const catalog = JSON.parse(await readFile(`${root}/catalog.json`, 'utf8'));
assert.equal(catalog.parts.length, 24);
assert.equal(new Set(catalog.parts.map((part) => part.id)).size, 24);
const report = [];
for (const part of catalog.parts) {
  const data = await readFile(`${root}/${part.id}.glb`);
  assert.equal(data.toString('utf8', 0, 4), 'glTF');
  assert.equal(data.readUInt32LE(4), 2);
  assert.equal(data.readUInt32LE(8), data.length);
  const jsonLength = data.readUInt32LE(12);
  const gltf = JSON.parse(data.toString('utf8', 20, 20 + jsonLength));
  const binary = data.subarray(28 + jsonLength);
  assert(gltf.nodes.some((node) => node.name === 'attachment-base'));
  assert(gltf.nodes.some((node) => node.name === 'attachment-tip'));
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let vertices = 0;
  for (const mesh of gltf.meshes) for (const primitive of mesh.primitives) {
    const accessor = gltf.accessors[primitive.attributes.POSITION];
    assert.equal(accessor.componentType, 5126);
    assert.equal(accessor.type, 'VEC3');
    const view = gltf.bufferViews[accessor.bufferView];
    const offset = (view.byteOffset || 0) + (accessor.byteOffset || 0), stride = view.byteStride || 12;
    for (let index = 0; index < accessor.count; index++) for (let axis = 0; axis < 3; axis++) {
      const value = binary.readFloatLE(offset + index * stride + axis * 4);
      assert(Number.isFinite(value), `${part.id}: nonfinite vertex`);
      min[axis] = Math.min(min[axis], value); max[axis] = Math.max(max[axis], value);
    }
    vertices += accessor.count;
  }
  for (let axis = 0; axis < 3; axis++) {
    assert(Math.abs(min[axis] - part.bounds.min[axis]) < 1e-5, `${part.id}: minimum mismatch`);
    assert(Math.abs(max[axis] - part.bounds.max[axis]) < 1e-5, `${part.id}: maximum mismatch`);
    assert(max[axis] > min[axis]);
  }
  assert(vertices > 0);
  report.push({ id: part.id, bytes: data.length, vertices, meshes: gltf.meshes.length, boundsVerified: true });
}
await mkdir('artifacts/e2e/plant-library-v2', { recursive: true });
await writeFile('artifacts/e2e/plant-library-v2/geometry-checks.json', JSON.stringify(report, null, 2));
console.log(`Verified ${report.length} GLBs; ${report.reduce((total, item) => total + item.bytes, 0)} bytes total.`);
