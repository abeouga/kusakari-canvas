// Offline GLB authoring. No geometry generation runs in the application.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Box3, BufferGeometry, CylinderGeometry, DoubleSide, Float32BufferAttribute,
  Group, Mesh, MeshStandardMaterial, Object3D, SphereGeometry, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then((value) => { this.result = value; this.onloadend(); }); }
};
const output = fileURLToPath(new URL('../frontend/public/models/plant-parts/v2/', import.meta.url));
await mkdir(output, { recursive: true });
const catalog = { version: 2, units: 'm', upAxis: 'Y', parts: [] };
const exporter = new GLTFExporter();
const material = (color) => new MeshStandardMaterial({ color, roughness: 0.85, side: DoubleSide });
const leafMaterial = material('#4f793b');
const petalMaterial = material('#dc88bb');
const barkMaterial = material('#71513b');

function mesh(group, geometry, mat, name, position = [0, 0, 0], scale = [1, 1, 1]) {
  const item = new Mesh(geometry, mat);
  item.name = name; item.position.fromArray(position); item.scale.fromArray(scale); group.add(item);
  return item;
}
function blade(shape) {
  const positions = [], indices = [], rows = 32;
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    let radius = Math.pow(Math.sin(Math.PI * t), 0.8) * 0.26;
    if (shape === 'narrow') radius *= 0.32;
    if (shape === 'needle') radius *= 0.08;
    if (shape === 'round') radius = Math.sqrt(Math.max(0, 1 - (t * 2 - 1) ** 2)) * 0.43;
    if (shape === 'heart') radius *= 1.7 * (1.2 - t);
    if (shape === 'split') radius *= (i % 5 === 2 || i % 5 === 3) && t > 0.12 ? 0.24 : 1.7;
    if (shape === 'succulent') radius *= 1.15;
    if (shape === 'grass') radius = Math.sin(Math.PI * t) * 0.035;
    for (let side = -1; side <= 1; side++) {
      const bend = shape === 'grass' ? t * t * 0.48 : Math.sin(Math.PI * t) * 0.07;
      positions.push(side * radius, t, bend + Math.abs(side) * 0.035);
    }
  }
  for (let i = 0; i < rows; i++) for (let side = 0; side < 2; side++) {
    const a = i * 3 + side, b = a + 3; indices.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  const group = new Group();
  mesh(group, geometry, leafMaterial, 'tint-leaf');
  if (shape === 'succulent') mesh(group, new SphereGeometry(1, 10, 6), leafMaterial,
    'tint-flesh', [0, 0.44, 0.035], [0.22, 0.44, 0.12]);
  return group;
}
function compound(palmate = false) {
  const group = new Group();
  mesh(group, new CylinderGeometry(0.008, 0.012, 1, 5), leafMaterial, 'tint-stalk', [0, 0.5, 0]);
  for (let i = 0; i < 7; i++) {
    const leaf = blade('narrow');
    if (palmate) { leaf.scale.setScalar(0.65); leaf.position.y = 0.3; leaf.rotation.z = (i - 3) * 0.34; }
    else { leaf.scale.setScalar(0.36); leaf.position.y = 0.18 + Math.floor(i / 2) * 0.2; leaf.rotation.z = i % 2 ? -0.9 : 0.9; }
    group.add(leaf);
  }
  return group;
}
function stem(kind) {
  const group = new Group();
  mesh(group, new CylinderGeometry(kind === 'herb' ? 0.32 : 0.25, 0.5, 1, 10, 4),
    kind === 'herb' ? leafMaterial : barkMaterial, kind === 'herb' ? 'tint-stem' : 'bark', [0, 0.5, 0]);
  if (kind === 'cane' || kind === 'palm') for (let i = 1; i < 8; i++) {
    mesh(group, new CylinderGeometry(0.43 - i * 0.02, 0.46 - i * 0.02, 0.025, 10),
      barkMaterial, 'ring', [0, i / 8, 0]);
  }
  return group;
}
function flower(kind) {
  const group = new Group();
  const ball = new SphereGeometry(1, 8, 5);
  if (kind === 'spike' || kind === 'plume') {
    const count = kind === 'spike' ? 28 : 45;
    for (let i = 0; i < count; i++) {
      const t = i / count, angle = i * 2.4, radius = (1 - t) * (kind === 'plume' ? 0.18 : 0.10);
      mesh(group, ball, petalMaterial, 'tint-floret', [Math.cos(angle) * radius, 0.08 + t * 0.85, Math.sin(angle) * radius],
        kind === 'plume' ? [0.045, 0.13, 0.045] : [0.055, 0.065, 0.055]);
    }
  } else if (kind === 'cluster') {
    for (let i = 0; i < 24; i++) {
      const y = 1 - (i + 0.5) / 24, radius = Math.sqrt(1 - y * y) * 0.42, a = i * 2.4;
      mesh(group, ball, petalMaterial, 'tint-floret', [Math.cos(a) * radius, 0.10 + y * 0.36, Math.sin(a) * radius], [0.14, 0.07, 0.14]);
    }
  } else if (kind === 'bell') {
    mesh(group, new CylinderGeometry(0.12, 0.36, 0.6, 16, 5, true), petalMaterial, 'tint-bell', [0, 0.30, 0]);
  } else {
    const count = kind === 'five' ? 5 : kind === 'eight' ? 8 : 20;
    for (let i = 0; i < count; i++) {
      const a = i * Math.PI * 2 / count;
      const petal = mesh(group, ball, petalMaterial, 'tint-petal', [Math.cos(a) * 0.25, 0.07, Math.sin(a) * 0.25],
        [0.28, 0.055, kind === 'daisy' ? 0.055 : 0.14]);
      petal.rotation.y = -a;
    }
    mesh(group, ball, material('#e6ba48'), 'center', [0, 0.10, 0], [0.12, 0.07, 0.12]);
  }
  return group;
}
function curvedStem(kind) {
  const group = new Group();
  for (let i = 0; i < 12; i++) {
    const a = i / 12, b = (i + 1) / 12;
    const position = (t) => kind === 'vine' ? new Vector3(Math.sin(t * 7) * 0.08, t, Math.cos(t * 7) * 0.08)
      : new Vector3(t * 0.22, t, 0);
    const from = position(a), to = position(b), direction = to.clone().sub(from);
    const segment = mesh(group, new CylinderGeometry(0.012, 0.016, direction.length(), 5), leafMaterial,
      'tint-stem', from.clone().add(to).multiplyScalar(0.5).toArray());
    segment.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize());
  }
  return group;
}
async function save(id, role, group) {
  // Merge equal-material pieces to bound draw calls (one per material, not one per petal).
  group.updateMatrixWorld(true);
  const batches = new Map();
  group.traverse((node) => {
    if (!node.isMesh) return;
    const key = node.material.uuid + (node.name.startsWith('tint-') ? ':tint' : ':fixed');
    if (!batches.has(key)) batches.set(key, { geometries: [], material: node.material, tint: node.name.startsWith('tint-') });
    const geometry = node.geometry.clone().applyMatrix4(node.matrixWorld);
    geometry.deleteAttribute('uv');
    batches.get(key).geometries.push(geometry);
  });
  const merged = new Group();
  for (const batch of batches.values()) mesh(merged, mergeGeometries(batch.geometries.map((geometry) => geometry.toNonIndexed())),
    batch.material, batch.tint ? 'tint-surface' : 'surface');
  const bounds = new Box3().setFromObject(merged), size = bounds.getSize(new Vector3());
  for (const [name, position] of [['attachment-base', [0, 0, 0]], ['attachment-tip', [0, 1, 0]]]) {
    const socket = new Object3D(); socket.name = name; socket.position.fromArray(position); merged.add(socket);
  }
  merged.name = id;
  const binary = await exporter.parseAsync(merged, { binary: true, onlyVisible: false });
  await writeFile(`${output}/${id}.glb`, Buffer.from(binary));
  catalog.parts.push({ id, role, modelUrl: `/models/plant-parts/v2/${id}.glb`,
    baseDimensions: { width: size.x, height: size.y, depth: size.z },
    bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
    connectors: { base: { position: [0, 0, 0] }, tip: { position: [0, 1, 0] } } });
}
for (const kind of ['wood', 'herb', 'cane', 'palm']) await save(`stem-${kind}`, 'stem', stem(kind));
for (const kind of ['oval', 'narrow', 'needle', 'round', 'heart', 'palmate', 'split', 'compound', 'succulent', 'grass']) {
  await save(`leaf-${kind}`, 'leaf', ['palmate', 'compound'].includes(kind) ? compound(kind === 'palmate') : blade(kind));
}
for (const kind of ['five', 'eight', 'spike', 'cluster', 'daisy', 'bell', 'plume']) await save(`flower-${kind}`, 'flower', flower(kind));
await save('stem-vine', 'stem', curvedStem('vine'));
await save('stem-arching', 'stem', curvedStem('arching'));
const frond = compound(false);
frond.scale.set(0.65, 1.6, 1);
await save('leaf-frond', 'leaf', frond);
await writeFile(`${output}/catalog.json`, JSON.stringify(catalog, null, 2) + '\n');
process.stdout.write(`Authored ${catalog.parts.length} v2 parts.\n`);
