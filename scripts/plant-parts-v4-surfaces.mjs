import { BufferGeometry, Color, CylinderGeometry, DoubleSide, Float32BufferAttribute,
  Group, Mesh, MeshStandardMaterial, Vector3 } from 'three';

const materials = new Map();
export function surface(geometry, roughness = 0.6, tint = true, pigment = null) {
  geometry.computeVertexNormals();
  const p = geometry.attributes.position, colors = [];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const v = 0.76 + 0.17 * Math.min(1, Math.max(0, y)) + 0.035 * Math.sin(x * 39 + y * 17 + z * 21);
    const c = pigment ? new Color(pigment).multiplyScalar(v) : new Color(v, v, v * 0.97);
    colors.push(c.r, c.g, c.b);
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  if (!materials.has(roughness)) materials.set(roughness,
    new MeshStandardMaterial({ color: '#ffffff', roughness, vertexColors: true, side: DoubleSide }));
  const mesh = new Mesh(geometry, materials.get(roughness)); mesh.name = tint ? 'tint-leaf' : 'fixed';
  return mesh;
}
export function twig(group, start, end, radius, pigment = null, roughness = 0.6) {
  const a = new Vector3(...start), b = new Vector3(...end), d = b.clone().sub(a);
  const mesh = surface(new CylinderGeometry(radius * 0.45, radius, d.length(), 4, 1, true), roughness, !pigment, pigment);
  mesh.position.copy(a.add(b).multiplyScalar(0.5));
  mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), d.normalize()); group.add(mesh);
}
export function blade({ rows = 12, width = 0.055, bend = 0.3, reach = 0.88, drop = 0.13, roll = 0 } = {}) {
  const vertices = [], indices = [], colors = [];
  for (let i = 0; i <= rows; i++) {
    const t = i / rows, r = width * Math.pow(Math.sin(Math.PI * t), 0.65);
    for (const side of [-1, 0, 1]) {
      vertices.push(side * r + roll * t * t, bend * Math.sin(t * Math.PI) - drop * t - Math.abs(side) * r * 0.22, reach * t);
      const v = side === 0 ? 0.95 : 0.65 + t * 0.22;
      colors.push(v, v, v * 0.88);
    }
  }
  for (let i = 0; i < rows; i++) for (let k = 0; k < 2; k++) {
    const a = i * 3 + k, b = a + 3; indices.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(vertices, 3)); g.setIndex(indices);
  const mesh = surface(g, 0.5); g.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const group = new Group(); group.add(mesh); return group;
}
export function naturalStem(herb = false) {
  const group = new Group();
  const g = new CylinderGeometry(herb ? 0.36 : 0.38, 0.5, 1, herb ? 5 : 8, 1, herb);
  g.translate(0, 0.5, 0);
  group.add(surface(g, herb ? 0.65 : 0.96, false, herb ? '#5d7740' : '#837361'));
  return group;
}
