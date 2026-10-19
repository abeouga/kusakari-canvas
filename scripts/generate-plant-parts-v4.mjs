// v1-v3 are immutable; only newly authored v4 parts are replaced here.
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Box3, Group, Mesh, Vector3 } from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { blade, naturalStem } from './plant-parts-v4-surfaces.mjs';
import { mapleLeaf, monsteraLeaf, scaleShoot } from './plant-parts-v4-leaves.mjs';
import { iberisFlowers, iberisShoot } from './plant-parts-v4-iberis.mjs';
globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then((value) => { this.result = value; this.onloadend(); }); }
};
const output = fileURLToPath(new URL('../frontend/public/models/plant-parts/v4/', import.meta.url));
const previous = fileURLToPath(new URL('../frontend/public/models/plant-parts/v3/', import.meta.url));
await mkdir(output, { recursive: true });
const old = JSON.parse(await readFile(`${previous}/catalog.json`, 'utf8'));
const catalog = { version: 4, units: 'm', upAxis: 'Y', parts: [] };
for (const part of old.parts) {
  await copyFile(`${previous}/${part.id}.glb`, `${output}/${part.id}.glb`);
  catalog.parts.push({ ...part, modelUrl: `/models/plant-parts/v4/${part.id}.glb` });
}
const parts = {
  'stem-natural': [() => naturalStem(false), 1], 'stem-petiole': [() => naturalStem(true), 1],
  'leaf-maple': [() => mapleLeaf(false), 1], 'leaf-maple-curl': [() => mapleLeaf(true), 1],
  'leaf-monstera': [() => monsteraLeaf(false), 1.047], 'leaf-monstera-young': [() => monsteraLeaf(true), 1.047],
  'leaf-hakone': [() => blade(), 1.102], 'leaf-hakone-curl': [() => blade({ roll: 0.08, bend: 0.24, drop: 0.20 }), 1.089],
  'leaf-goldcrest': [scaleShoot, 1], 'leaf-iberis-v4': [iberisShoot, 0.35],
  'flower-iberis-v4': [iberisFlowers, 0.195],
};
for (const [id, [create, referenceLength]] of Object.entries(parts)) {
  const source = create(), batches = new Map(), group = new Group(), points = [];
  source.updateMatrixWorld(true);
  source.traverse((node) => {
    if (!node.isMesh) return;
    const tint = node.name.startsWith('tint-'), key = node.material.uuid + (tint ? ':tint' : ':fixed');
    if (!batches.has(key)) batches.set(key, { material: node.material, tint, geometries: [] });
    const g = node.geometry.clone().applyMatrix4(node.matrixWorld); g.deleteAttribute('uv');
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) points.push(new Vector3(p.getX(i), p.getY(i), p.getZ(i)));
    batches.get(key).geometries.push(g.index ? g.toNonIndexed() : g);
  });
  for (const b of batches.values()) {
    const mesh = new Mesh(mergeGeometries(b.geometries), b.material);
    mesh.name = b.tint ? 'tint-surface' : 'surface'; group.add(mesh);
  }
  const binary = Buffer.from(await new GLTFExporter().parseAsync(group, { binary: true }));
  await writeFile(`${output}/${id}.glb`, binary);
  const box = new Box3().setFromPoints(points), size = box.getSize(new Vector3());
  const hull = new ConvexGeometry(points).attributes.position, vertices = new Map();
  for (let i = 0; i < hull.count; i++) {
    const p = [hull.getX(i), hull.getY(i), hull.getZ(i)]; vertices.set(p.join(','), p);
  }
  catalog.parts.push({ id, role: id.split('-')[0], modelUrl: `/models/plant-parts/v4/${id}.glb`,
    baseDimensions: { width: size.x, height: size.y, depth: size.z }, referenceLength,
    bounds: { min: box.min.toArray(), max: box.max.toArray() }, hull: [...vertices.values()],
    connectors: { base: { position: [0, 0, 0] }, tip: { position: [0, 1, 0] } } });
  const triangles = group.children.reduce((n, mesh) => n + mesh.geometry.attributes.position.count / 3, 0);
  console.log(`${id}: ${triangles} triangles; ${batches.size} batches; ${binary.length} bytes`);
}
await writeFile(`${output}/catalog.json`, JSON.stringify(catalog, null, 2) + '\n');
console.log(`Authored ${Object.keys(parts).length} new parts; retained ${old.parts.length} legacy parts.`);
