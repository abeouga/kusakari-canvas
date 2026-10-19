import { CylinderGeometry, Group, Shape, ShapeGeometry } from 'three';
import { surface, twig } from './plant-parts-v4-surfaces.mjs';

export function iberisShoot() {
  const group = new Group(); twig(group, [0, 0, 0], [0, 1, 0], 0.016, null, 0.45);
  for (let i = 0; i < 22; i++) {
    const shape = new Shape(); shape.moveTo(0, 0);
    shape.bezierCurveTo(-0.015, 0.15, -0.095, 0.76, -0.08, 0.92);
    shape.bezierCurveTo(-0.08, 1.025, 0.08, 1.025, 0.08, 0.92);
    shape.bezierCurveTo(0.095, 0.76, 0.015, 0.15, 0, 0);
    const g = new ShapeGeometry(shape, 4), p = g.attributes.position;
    for (let j = 0; j < p.count; j++) p.setZ(j, -0.12 * p.getY(j) ** 2 + Math.abs(p.getX(j)) * 0.4);
    const leaf = surface(g, 0.45); leaf.scale.setScalar(0.35 * (0.85 + 0.15 * Math.sin(i * 4.3)));
    leaf.rotation.z = 0.78 + Math.sin(i * 1.8) * 0.16; leaf.position.y = 0.03 + i / 22 * 0.90;
    const node = new Group(); node.rotation.y = i * 2.39996; node.add(leaf); group.add(node);
  }
  return group;
}
export function iberisFlowers() {
  const group = new Group();
  for (let i = 0; i < 16; i++) {
    const a = i * 2.39996, r = 0.25 * Math.sqrt(i / 15), flower = new Group();
    flower.position.set(Math.cos(a) * r, 0.06 + 0.012 * Math.sin(i * 3), Math.sin(a) * r);
    flower.rotation.y = a; flower.rotation.z = Math.sin(i * 4) * 0.1;
    const size = 0.24 * (0.88 + 0.12 * Math.sin(i * 5));
    for (let petal = 0; petal < 4; petal++) {
      const s = new Shape(); s.moveTo(0, 0);
      s.bezierCurveTo(-0.20, 0.2, -0.16, 0.48, 0, 0.48);
      s.bezierCurveTo(0.16, 0.48, 0.20, 0.2, 0, 0);
      const g = new ShapeGeometry(s, 4), p = g.attributes.position;
      for (let k = 0; k < p.count; k++) p.setZ(k, p.getY(k) ** 2 * 0.12);
      const mesh = surface(g, 0.78); mesh.name = 'tint-petal';
      mesh.rotation.x = -Math.PI / 2; mesh.rotation.z = petal * Math.PI / 2;
      mesh.scale.setScalar(size * (petal < 2 ? 1 : 0.72)); flower.add(mesh);
    }
    const center = surface(new CylinderGeometry(size * 0.055, size * 0.05, size * 0.025, 4), 0.75, false, '#d3bb5d');
    flower.add(center); group.add(flower);
    twig(group, [0, 0, 0], flower.position.toArray(), 0.004, '#5c7542', 0.75);
  }
  return group;
}
