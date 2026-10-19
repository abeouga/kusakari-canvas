import { Float32BufferAttribute, Group, Path, Shape, ShapeGeometry } from 'three';
import { surface, twig } from './plant-parts-v4-surfaces.mjs';

export function mapleLeaf(curled = false) {
  const tips = [-106, -71, -35, 0, 35, 71, 106].map((a, i) => {
    const angle = a * Math.PI / 180, r = [0.33, 0.49, 0.6, 0.66, 0.59, 0.46, 0.32][i];
    return [Math.sin(angle) * r, 0.34 + Math.cos(angle) * r];
  });
  const outline = [[0, 0], [-0.12, 0.09]];
  tips.forEach((tip, i) => {
    if (i) { const a = (-106 + (i - 0.5) * 35.33) * Math.PI / 180; outline.push([Math.sin(a) * 0.17, 0.34 + Math.cos(a) * 0.17]); }
    outline.push(tip);
  });
  outline.push([0.12, 0.09], [0, 0]);
  const shape = new Shape(); shape.moveTo(...outline[0]);
  for (let i = 1; i < outline.length; i++) {
    const a = outline[i - 1], b = outline[i];
    for (let k = 1; k <= 3; k++) {
      const t = k / 3, tooth = k === 2 ? 0.028 : 0;
      shape.lineTo(a[0] * (1 - t) + b[0] * t + (b[1] - a[1]) * tooth,
        a[1] * (1 - t) + b[1] * t - (b[0] - a[0]) * tooth);
    }
  }
  const g = new ShapeGeometry(shape), p = g.attributes.position;
  const depth = (x, y) => (curled ? 0.23 : 0.12) * (Math.abs(x) - y * y * 0.7) + Math.sin(y * 5) * x * 0.08;
  for (let i = 0; i < p.count; i++) p.setZ(i, depth(p.getX(i), p.getY(i)));
  const group = new Group(); group.add(surface(g, 0.64));
  for (const tip of tips) twig(group, [0, 0.02, 0.004], [tip[0] * 0.88, tip[1] * 0.88, depth(tip[0] * 0.88, tip[1] * 0.88) + 0.004], 0.0018, null, 0.64);
  return group;
}

export function monsteraLeaf(young = false) {
  const shape = new Shape(); shape.moveTo(0, 0);
  if (young) {
    shape.bezierCurveTo(-0.28, -0.2, -0.58, 0.06, -0.34, 0.58);
    shape.quadraticCurveTo(-0.16, 0.9, 0, 1);
    shape.quadraticCurveTo(0.22, 0.87, 0.37, 0.5);
    shape.bezierCurveTo(0.58, 0.03, 0.22, -0.18, 0, 0);
  } else {
    const edge = new Path(); edge.moveTo(0, 0);
    edge.bezierCurveTo(-0.24, -0.2, -0.55, 0.02, -0.48, 0.24);
    edge.quadraticCurveTo(-0.44, 0.3, -0.17, 0.28);
    edge.quadraticCurveTo(-0.13, 0.3, -0.18, 0.32); edge.lineTo(-0.44, 0.38);
    edge.quadraticCurveTo(-0.5, 0.45, -0.39, 0.55); edge.lineTo(-0.13, 0.48);
    edge.quadraticCurveTo(-0.1, 0.5, -0.16, 0.54);
    edge.lineTo(-0.34, 0.65); edge.quadraticCurveTo(-0.32, 0.74, -0.25, 0.78);
    edge.lineTo(-0.075, 0.66); edge.quadraticCurveTo(-0.055, 0.68, -0.09, 0.72);
    edge.lineTo(-0.19, 0.85); edge.quadraticCurveTo(-0.1, 0.94, 0, 1);
    const half = edge.getPoints(7).map((p) => [p.x, p.y]);
    for (const p of half.slice(1)) shape.lineTo(...p);
    for (const [x, y] of half.slice(0, -1).reverse()) shape.lineTo(-x * (0.98 + 0.04 * y), y);
    for (const sign of [-1, 1]) for (const y of [0.2, 0.38, 0.56]) {
      const hole = new Path(); hole.absellipse(sign * (0.13 - y * 0.08), y, 0.023, 0.047, 0, Math.PI * 2, true);
      shape.holes.push(hole);
    }
  }
  const g = new ShapeGeometry(shape, 5);
  // Interior samples allow a smooth curved lamina rather than boundary-only flat facets.
  const positions = [...g.attributes.position.array], indices = [];
  for (let i = 0; i < g.index.count; i += 3) {
    const ids = [g.index.getX(i), g.index.getX(i + 1), g.index.getX(i + 2)];
    const p = ids.map((id) => positions.slice(id * 3, id * 3 + 3));
    const area = Math.abs((p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[2][0] - p[0][0]) * (p[1][1] - p[0][1]));
    if (area > 0.008) {
      const center = positions.length / 3; positions.push(...[0, 1, 2].map((k) => (p[0][k] + p[1][k] + p[2][k]) / 3));
      indices.push(ids[0], ids[1], center, ids[1], ids[2], center, ids[2], ids[0], center);
    } else indices.push(...ids);
  }
  g.setAttribute('position', new Float32BufferAttribute(positions, 3)); g.setIndex(indices); g.deleteAttribute('normal'); g.deleteAttribute('uv');
  const p = g.attributes.position;
  const depth = (x, y) => -0.22 * y * y + 0.30 * Math.abs(x) + 0.025 * Math.sin(y * 19) * Math.abs(x);
  for (let i = 0; i < p.count; i++) p.setZ(i, depth(p.getX(i), p.getY(i)));
  const group = new Group(); group.add(surface(g, 0.42));
  // Veins are tiny shared mesh ribbons/rods, not an image or extra draw pass.
  for (let i = 0; i < 4; i++) {
    const y = i * 0.24, next = y + 0.24;
    twig(group, [0, y, depth(0, y) + 0.005], [0, next, depth(0, next) + 0.005], 0.004, null, 0.42);
  }
  for (const y of [0.18, 0.39, 0.6]) for (const side of [-1, 1]) {
    const x = side * (0.46 - y * 0.28), top = y + 0.16;
    twig(group, [0, y, depth(0, y) + 0.004], [x, top, depth(x, top) + 0.004], 0.0018, null, 0.42);
  }
  return group;
}

export function scaleShoot() {
  const group = new Group();
  twig(group, [0, 0, 0], [0, 1, 0], 0.012, null, 0.7);
  // Two crossed sprays supply volume with few triangles, no alpha overdraw.
  for (let plane = 0; plane < 2; plane++) {
    const spray = new Group(); spray.rotation.y = plane * Math.PI * 0.5;
    for (let tier = 0; tier < 5; tier++) for (const side of [-1, 1]) {
      const y = 0.05 + tier * 0.17, width = (0.29 - tier * 0.04) * side;
      const s = new Shape(); s.moveTo(0, y);
      s.lineTo(width * 0.6, y + 0.10); s.lineTo(width, y + 0.31);
      s.lineTo(width * 0.7, y + 0.22); s.lineTo(width * 0.75, y + 0.34);
      s.lineTo(width * 0.42, y + 0.23); s.lineTo(width * 0.43, y + 0.37); s.lineTo(0, y + 0.16);
      const mesh = surface(new ShapeGeometry(s), 0.7); spray.add(mesh);
    }
    group.add(spray);
  }
  return group;
}
