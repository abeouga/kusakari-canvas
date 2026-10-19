// Authoring tool only. The application loads these checked-in GLBs; it never runs this script.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { BufferGeometry, CylinderGeometry, DoubleSide, Float32BufferAttribute, Group, Mesh,
  MeshStandardMaterial, Object3D, SphereGeometry } from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then((result) => { this.result = result; this.onloadend(); }); }
};
const output = fileURLToPath(new URL('../frontend/public/models/plant-parts/v1/', import.meta.url));
await mkdir(output, { recursive: true });
const catalog = { version: 1, units: 'm', upAxis: 'Y', parts: [] };
const exporter = new GLTFExporter();
const bark = new MeshStandardMaterial({ color: '#796046', roughness: 1 });
const green = new MeshStandardMaterial({ color: '#4f793b', roughness: 0.85, side: DoubleSide });
function socket(group, name, position) {
  const node = new Object3D();
  node.name = name;
  node.position.fromArray(position);
  group.add(node);
}
async function save(id, role, group, dimensions, tip = [0, 1, 0]) {
  socket(group, 'attachment-base', [0, 0, 0]);
  socket(group, 'attachment-tip', tip);
  group.name = id;
  const binary = await exporter.parseAsync(group, { binary: true, onlyVisible: false });
  await writeFile(resolve(output, `${id}.glb`), Buffer.from(binary));
  catalog.parts.push({ id, role, modelUrl: `/models/plant-parts/v1/${id}.glb`,
    baseDimensions: dimensions, connectors: {
      base: { position: [0, 0, 0], direction: [0, 1, 0], kind: role === 'stem' ? 'stem' : 'tip' },
      tip: { position: tip, direction: [0, 1, 0], kind: 'tip' },
    } });
}
function stem() {
  const group = new Group();
  const mesh = new Mesh(new CylinderGeometry(0.32, 0.5, 1, 12, 5), bark);
  mesh.position.y = 0.5;
  group.add(mesh);
  return group;
}
function leaf(width, serrated) {
  const positions = [], indices = [];
  const rows = 18;
  for (let row = 0; row <= rows; row++) {
    const t = row / rows;
    let radius = Math.pow(Math.sin(Math.PI * t), 0.85) * width;
    if (serrated && row % 2) radius *= 0.84;
    for (let side = -1; side <= 1; side++) {
      positions.push(side * radius, 0.12 + t * 0.88, Math.sin(t * Math.PI) * 0.09 + Math.abs(side) * 0.035);
    }
  }
  for (let row = 0; row < rows; row++) {
    for (let side = 0; side < 2; side++) {
      const a = row * 3 + side, b = a + 3;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const group = new Group();
  const blade = new Mesh(geometry, green);
  blade.name = 'tint-leaf';
  group.add(blade);
  const petiole = new Mesh(new CylinderGeometry(0.009, 0.012, 0.3, 5), green);
  petiole.position.y = 0.15;
  petiole.name = 'tint-petiole';
  group.add(petiole);
  return group;
}
function flower(petals) {
  const group = new Group();
  const petalMaterial = new MeshStandardMaterial({ color: '#df7799', roughness: 0.8, side: DoubleSide });
  for (let index = 0; index < petals; index++) {
    const angle = index / petals * Math.PI * 2;
    const petal = new Mesh(new SphereGeometry(1, 12, 8), petalMaterial);
    petal.position.set(Math.cos(angle) * 0.24, 0.055, Math.sin(angle) * 0.24);
    petal.scale.set(0.29, 0.055, 0.14);
    petal.rotation.y = -angle;
    petal.name = `tint-petal-${index}`;
    group.add(petal);
  }
  const center = new Mesh(new SphereGeometry(0.115, 12, 8), new MeshStandardMaterial({ color: '#e6bf49' }));
  center.position.y = 0.075;
  center.scale.y = 0.55;
  group.add(center);
  return group;
}
await save('stem', 'stem', stem(), { width: 1, height: 1, depth: 1 });
await save('leaf-oval', 'leaf', leaf(0.25, true), { width: 0.5, height: 1, depth: 0.13 });
await save('leaf-narrow', 'leaf', leaf(0.10, false), { width: 0.2, height: 1, depth: 0.13 });
await save('leaf-needle', 'leaf', leaf(0.025, false), { width: 0.05, height: 1, depth: 0.13 });
await save('flower-five', 'flower', flower(5), { width: 1.06, height: 0.16, depth: 1.06 }, [0, 0.15, 0]);
await save('flower-eight', 'flower', flower(8), { width: 1.06, height: 0.16, depth: 1.06 }, [0, 0.15, 0]);
await writeFile(resolve(output, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
process.stdout.write(`Prepared ${catalog.parts.length} reusable GLB parts.\n`);
