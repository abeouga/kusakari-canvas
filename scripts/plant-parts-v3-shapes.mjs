import { BufferGeometry, Color, CylinderGeometry, DoubleSide, Float32BufferAttribute,
  Group, Mesh, MeshStandardMaterial, Path, Shape, ShapeGeometry, Vector3 } from 'three';

const green = new MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.67, side: DoubleSide });
const white = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.8, side: DoubleSide });
function surface(geometry, tint = 'leaf') {
  geometry.computeVertexNormals();
  const positions = geometry.attributes.position, colors = [];
  for (let i = 0; i < positions.count; i++) {
    const value = 0.72 + Math.min(0.25, positions.getY(i) * 0.18) + Math.abs(positions.getX(i)) * 0.06;
    const color = new Color(value, Math.min(1, value + 0.04), value * 0.91);
    colors.push(color.r, color.g, color.b);
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const item = new Mesh(geometry, green); item.name = `tint-${tint}`;
  return item;
}
function vein(group, from, to, radius = 0.003) {
  const a = new Vector3(...from), b = new Vector3(...to), d = b.clone().sub(a);
  const geometry = new CylinderGeometry(radius * 0.4, radius, d.length(), 4);
  const item = surface(geometry, 'vein'); item.position.copy(a.add(b).multiplyScalar(0.5));
  item.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), d.normalize()); group.add(item);
}
function foldedShape(shape, amount = 0.12) {
  const geometry = new ShapeGeometry(shape, 8), points = geometry.attributes.position;
  for (let i = 0; i < points.count; i++) {
    const x = points.getX(i), y = points.getY(i);
    points.setZ(i, amount * (Math.abs(x) - 0.3 * y * y));
  }
  return geometry;
}
export function mapleLeaf() {
  // A single continuous 7-lobed lamina, not seven independent leaflets.
  const tips = [-105, -70, -35, 0, 35, 70, 105].map((a, i) => {
    const angle = a * Math.PI / 180, r = [0.34, 0.48, 0.57, 0.62, 0.57, 0.48, 0.34][i];
    return [Math.sin(angle) * r, 0.38 + Math.cos(angle) * r];
  });
  const outline = [[0, 0], [-0.13, 0.08]];
  for (let i = 0; i < tips.length; i++) {
    if (i) { const a = (-105 + (i - 0.5) * 35) * Math.PI / 180; outline.push([Math.sin(a) * 0.21, 0.38 + Math.cos(a) * 0.21]); }
    outline.push(tips[i]);
  }
  outline.push([0.13, 0.08], [0, 0]);
  const shape = new Shape(); shape.moveTo(...outline[0]);
  for (let i = 1; i < outline.length; i++) {
    const a = outline[i - 1], b = outline[i];
    for (let j = 1; j <= 6; j++) {
      const t = j / 6, serration = j % 2 && i > 1 && i < outline.length - 1 ? 0.008 : 0;
      shape.lineTo(a[0] * (1 - t) + b[0] * t + (b[1] - a[1]) * serration,
        a[1] * (1 - t) + b[1] * t - (b[0] - a[0]) * serration);
    }
  }
  const group = new Group(); group.add(surface(foldedShape(shape)));
  for (const tip of tips) vein(group, [0, 0.05, 0.008], [tip[0] * 0.9, tip[1] * 0.9, 0.018], 0.002);
  return group;
}
export function monsteraLeaf() {
  const edge = new Path(); edge.moveTo(0, 0);
  edge.bezierCurveTo(-0.22, -0.23, -0.51, -0.04, -0.48, 0.22);
  edge.quadraticCurveTo(-0.46, 0.29, -0.18, 0.26); edge.quadraticCurveTo(-0.13, 0.28, -0.18, 0.30);
  edge.lineTo(-0.45, 0.35); edge.bezierCurveTo(-0.49, 0.37, -0.43, 0.49, -0.39, 0.52);
  edge.lineTo(-0.14, 0.45); edge.quadraticCurveTo(-0.10, 0.46, -0.14, 0.50);
  edge.lineTo(-0.35, 0.61); edge.quadraticCurveTo(-0.37, 0.67, -0.27, 0.75);
  edge.lineTo(-0.09, 0.63); edge.quadraticCurveTo(-0.065, 0.65, -0.09, 0.69);
  edge.lineTo(-0.20, 0.83); edge.quadraticCurveTo(-0.15, 0.92, 0, 1);
  const half = edge.getPoints(8).map((p) => [p.x, p.y]);
  const shape = new Shape(); shape.moveTo(...half[0]);
  for (const p of half.slice(1)) shape.lineTo(...p);
  for (const [x, y] of half.slice(0, -1).reverse()) shape.lineTo(-x, y);
  for (const sign of [-1, 1]) for (const y of [0.20, 0.38, 0.56]) {
    const hole = new Path(); hole.absellipse(sign * (0.13 - y * 0.08), y, 0.024, 0.048, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }
  const group = new Group(); group.add(surface(foldedShape(shape, 0.18)));
  vein(group, [0, 0, 0.009], [0, 0.96, -0.04], 0.004);
  return group;
}
export function grassBlade() {
  const positions = [], indices = [], rows = 24;
  // Arched midrib; roll is supplied by the assembly so blades bend radially, not all in world +Z.
  for (let i = 0; i <= rows; i++) {
    const t = i / rows, radius = Math.pow(Math.sin(Math.PI * t), 0.72) * 0.028;
    for (const side of [-1, 0, 1]) positions.push(side * radius,
      Math.sin(t * Math.PI * 0.78) * 0.49, t * 0.73 - Math.abs(side) * radius * 0.25);
  }
  for (let i = 0; i < rows; i++) for (let k = 0; k < 2; k++) {
    const a = i * 3 + k, b = a + 3; indices.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const geometry = new BufferGeometry(); geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices); const group = new Group(); group.add(surface(geometry)); return group;
}
export function scaleShoot() {
  // A foliage-bearing shoot with short overlapping scales, not a long pine needle.
  const group = new Group();
  vein(group, [0, 0, 0], [0, 1, 0], 0.012);
  for (let tier = 0; tier < 5; tier++) for (const side of [-1, 1]) {
    const y = 0.12 + tier * 0.16, end = [side * (0.30 - tier * 0.03), y + 0.22, 0.025];
    vein(group, [0, y, 0], end, 0.008);
    for (let i = 0; i < 7; i++) for (let k = 0; k < 2; k++) {
      const t = i / 7, x = end[0] * t, v = y + 0.22 * t;
      const shape = new Shape(); shape.moveTo(x, v); shape.lineTo(x + side * 0.04, v + 0.045);
      shape.lineTo(x + (k ? -1 : 1) * 0.02, v + 0.08); shape.closePath();
      const leaf = surface(foldedShape(shape, 0.1)); leaf.position.z = (k - 0.5) * 0.018; group.add(leaf);
    }
  }
  return group;
}
export function fourPetalFlower() {
  const group = new Group();
  // Iberis has two larger outer petals and two smaller inner petals.
  for (let i = 0; i < 4; i++) {
    const shape = new Shape(); shape.moveTo(0, 0); shape.bezierCurveTo(-0.2, 0.16, -0.18, 0.45, 0, 0.45);
    shape.bezierCurveTo(0.18, 0.45, 0.2, 0.16, 0, 0);
    const petal = new Mesh(new ShapeGeometry(shape, 6), white); petal.name = 'tint-petal';
    petal.rotation.x = -Math.PI / 2; petal.rotation.z = i * Math.PI / 2;
    petal.scale.setScalar(i < 2 ? 1 : 0.72); group.add(petal);
  }
  const center = new Mesh(new CylinderGeometry(0.055, 0.035, 0.025, 6),
    new MeshStandardMaterial({ color: '#c8b65d', roughness: 0.8 })); center.name = 'center'; group.add(center);
  return group;
}

export function stemPart(kind) {
  const group = new Group();
  const mat = new MeshStandardMaterial({ color: kind === 'herb' ? '#527340' : '#725542', roughness: 0.93 });
  const item = new Mesh(new CylinderGeometry(0.46, 0.5, 1, 10, 2), mat);
  item.position.y = 0.5; item.name = 'stem'; group.add(item); return group;
}

export function iberisShoot() {
  const group = new Group(); vein(group, [0, 0, 0], [0, 1, 0], 0.018);
  for (let i = 0; i < 26; i++) {
    const shape = new Shape(); shape.moveTo(0, 0);
    shape.bezierCurveTo(-0.07, 0.35, -0.07, 0.82, 0, 1);
    shape.bezierCurveTo(0.07, 0.82, 0.07, 0.35, 0, 0);
    const leaf = surface(foldedShape(shape, 0.1)); leaf.scale.setScalar(0.35);
    leaf.position.y = 0.08 + i / 26 * 0.84; leaf.rotation.z = 0.9;
    const branch = new Group(); branch.rotation.y = i * 2.39996; branch.add(leaf); group.add(branch);
  }
  return group;
}

export function iberisFlowers() {
  const group = new Group();
  for (let i = 0; i < 20; i++) {
    const a = i * 2.39996, r = 0.46 * Math.sqrt(i / 19);
    const flower = fourPetalFlower(); flower.scale.setScalar(0.30);
    flower.position.set(Math.cos(a) * r, 0.14 + 0.07 * (1 - i / 20), Math.sin(a) * r);
    flower.rotation.y = a; group.add(flower);
    const start = new Vector3(0, 0, 0), end = flower.position, d = end.clone().sub(start);
    const stalk = new Mesh(new CylinderGeometry(0.003, 0.006, d.length(), 4),
      new MeshStandardMaterial({ color: '#547b3a', roughness: 0.8 }));
    stalk.name = 'pedicel'; stalk.position.copy(end).multiplyScalar(0.5);
    stalk.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), d.normalize()); group.add(stalk);
  }
  return group;
}
