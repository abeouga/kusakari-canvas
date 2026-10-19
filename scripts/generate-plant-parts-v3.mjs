// Immutable v1/v2 assets are retained. v3 ships exact convex support hulls for server-side measurements.
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Box3, BufferGeometry, Group, Mesh, Object3D, Vector3 } from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { fourPetalFlower, grassBlade, iberisFlowers, iberisShoot, mapleLeaf, monsteraLeaf, scaleShoot, stemPart } from './plant-parts-v3-shapes.mjs';

globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then((value) => { this.result = value; this.onloadend(); }); }
};
const output = fileURLToPath(new URL('../frontend/public/models/plant-parts/v3/', import.meta.url));
const previous = fileURLToPath(new URL('../frontend/public/models/plant-parts/v2/', import.meta.url));
await mkdir(output, { recursive: true });
const old = JSON.parse(await readFile(`${previous}/catalog.json`, 'utf8'));
const catalog = { version: 3, units: 'm', upAxis: 'Y', parts: [] };
const replacements = { 'leaf-palmate': mapleLeaf, 'leaf-split': monsteraLeaf, 'leaf-grass': grassBlade,
  'leaf-scale': scaleShoot, 'flower-four': fourPetalFlower, 'leaf-iberis': iberisShoot, 'flower-iberis': iberisFlowers,
  'stem-wood': () => stemPart('wood'), 'stem-herb': () => stemPart('herb') };
function pointsFromGlb(data) {
  const size = data.readUInt32LE(12), gltf = JSON.parse(data.toString('utf8', 20, 20 + size)), bin = data.subarray(28 + size);
  const points = [];
  for (const mesh of gltf.meshes) for (const primitive of mesh.primitives) {
    const a = gltf.accessors[primitive.attributes.POSITION], v = gltf.bufferViews[a.bufferView];
    const offset = (a.byteOffset || 0) + (v.byteOffset || 0);
    for (let i = 0; i < a.count; i++) points.push(new Vector3(...[0, 1, 2].map((axis) =>
      bin.readFloatLE(offset + i * (v.byteStride || 12) + axis * 4))));
  }
  return points;
}
function entry(id, points, role) {
  const bounds = new Box3().setFromPoints(points), size = bounds.getSize(new Vector3());
  const hull = new ConvexGeometry(points).attributes.position;
  const vertices = new Map();
  for (let i = 0; i < hull.count; i++) {
    const p = [hull.getX(i), hull.getY(i), hull.getZ(i)]; vertices.set(p.join(','), p);
  }
  return { id, role, modelUrl: `/models/plant-parts/v3/${id}.glb`,
    baseDimensions: { width: size.x, height: size.y, depth: size.z },
    referenceLength: id === 'leaf-iberis' ? 0.35 : id === 'flower-iberis' ? 0.27
      : role === 'flower' ? Math.max(size.x, size.y, size.z) : id === 'leaf-grass' ? 1.1 : size.y,
    bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() }, hull: [...vertices.values()],
    connectors: { base: { position: [0, 0, 0] }, tip: { position: [0, 1, 0] } } };
}
for (const part of old.parts) {
  if (replacements[part.id]) continue;
  await copyFile(`${previous}/${part.id}.glb`, `${output}/${part.id}.glb`);
  catalog.parts.push(entry(part.id, pointsFromGlb(await readFile(`${output}/${part.id}.glb`)), part.role));
}
for (const [id, create] of Object.entries(replacements)) {
  const source = create(), batches = new Map(), group = new Group(); source.updateMatrixWorld(true);
  source.traverse((node) => {
    if (!node.isMesh) return;
    const key = node.material.uuid + (node.name.startsWith('tint-') ? ':tint' : ':fixed');
    if (!batches.has(key)) batches.set(key, { material: node.material, tint: node.name.startsWith('tint-'), geometries: [] });
    const g = node.geometry.clone().applyMatrix4(node.matrixWorld); g.deleteAttribute('uv');
    batches.get(key).geometries.push(g.index ? g.toNonIndexed() : g);
  });
  for (const batch of batches.values()) {
    const geometry = mergeGeometries(batch.geometries);
    if (!(geometry instanceof BufferGeometry)) throw new Error(`Cannot merge ${id}`);
    const mesh = new Mesh(geometry, batch.material); mesh.name = batch.tint ? 'tint-surface' : 'surface'; group.add(mesh);
  }
  for (const [name, y] of [['attachment-base', 0], ['attachment-tip', 1]]) {
    const socket = new Object3D(); socket.name = name; socket.position.y = y; group.add(socket);
  }
  const binary = Buffer.from(await new GLTFExporter().parseAsync(group, { binary: true }));
  await writeFile(`${output}/${id}.glb`, binary);
  catalog.parts.push(entry(id, pointsFromGlb(binary), id.split('-')[0]));
}
await writeFile(`${output}/catalog.json`, JSON.stringify(catalog, null, 2) + '\n');
console.log(`Authored ${catalog.parts.length} immutable v3 parts with exact support hulls.`);
