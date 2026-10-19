// Independent of the Python fitter and its hull metadata: measure every actual GLB POSITION vertex.
import { readFile } from 'node:fs/promises';
import { Matrix4, Quaternion, Vector3 } from 'three';
export async function readPlantMeshes(version) {
  const root = new URL(`../frontend/public/models/plant-parts/v${version}/`, import.meta.url);
  const catalog = JSON.parse(await readFile(new URL('catalog.json', root), 'utf8'));
  const meshes = new Map();
  for (const part of catalog.parts) {
    const data = await readFile(new URL(`${part.id}.glb`, root));
    const size = data.readUInt32LE(12), gltf = JSON.parse(data.toString('utf8', 20, size + 20));
    const bin = data.subarray(28 + size), points = []; let triangles = 0;
    if (gltf.nodes.some((n) => n.mesh !== undefined && (n.matrix || n.translation || n.rotation || n.scale)))
      throw new Error('Unexpected mesh transform: independent measurement must account for it.');
    for (const mesh of gltf.meshes) for (const primitive of mesh.primitives) {
      const a = gltf.accessors[primitive.attributes.POSITION], v = gltf.bufferViews[a.bufferView];
      const offset = (v.byteOffset || 0) + (a.byteOffset || 0), stride = v.byteStride || 12;
      for (let i = 0; i < a.count; i++) points.push([0, 1, 2].map((axis) => bin.readFloatLE(offset + i * stride + axis * 4)));
      triangles += (primitive.indices === undefined ? a.count : gltf.accessors[primitive.indices].count) / 3;
    }
    meshes.set(part.id, { points, triangles });
  }
  return meshes;
}
export function measurePlant(composition, meshes) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]; let triangles = 0;
  for (const part of composition.parts) {
    const source = meshes.get(part.partId); if (!source) throw new Error(`Unknown ${part.partId}`);
    triangles += source.triangles;
    const matrix = new Matrix4().makeScale(...composition.fitScale).multiply(new Matrix4().compose(
      new Vector3(...part.position), new Quaternion(...part.quaternion), new Vector3(...part.scale)));
    const point = new Vector3();
    for (const v of source.points) {
      point.fromArray(v).applyMatrix4(matrix);
      [point.x, point.y, point.z].forEach((value, axis) => { min[axis] = Math.min(min[axis], value); max[axis] = Math.max(max[axis], value); });
    }
  }
  const size = max.map((value, axis) => value - min[axis]);
  return { min, max, size, triangles, heightError: Math.abs(max[1] * 100 / composition.profile.heightCm - 1),
    widthError: Math.abs(Math.max(size[0], size[2]) * 100 / composition.profile.widthCm - 1) };
}
