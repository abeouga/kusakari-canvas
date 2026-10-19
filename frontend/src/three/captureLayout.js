import { Box3, Vector3, Vector4 } from 'three';

function projectPoint(point, camera, width, height) {
  const clip = new Vector4(point.x, point.y, point.z, 1);
  clip.applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
  if (clip.w <= 0) return null;
  const x = (clip.x / clip.w + 1) * width / 2;
  const y = (1 - clip.y / clip.w) * height / 2;
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1_000_000 || Math.abs(y) > 1_000_000) return null;
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
}

function projectedBounds(node, camera, width, height) {
  const box = new Box3().setFromObject(node);
  if (box.isEmpty()) return null;
  const points = [];
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        const point = projectPoint(new Vector3(x, y, z), camera, width, height);
        if (point) points.push(point);
      }
    }
  }
  if (points.length === 0) return null;
  // A box crossing the camera plane has no reliable finite projected envelope.
  if (points.length !== 8) return { x: 0, y: 0, width, height };
  const left = Math.max(0, Math.floor(Math.min(...points.map((point) => point.x))));
  const top = Math.max(0, Math.floor(Math.min(...points.map((point) => point.y))));
  const right = Math.min(width, Math.ceil(Math.max(...points.map((point) => point.x))));
  const bottom = Math.min(height, Math.ceil(Math.max(...points.map((point) => point.y))));
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function captureLayout(placements, camera, width, height) {
  return placements.map((placement) => {
    const origin = placement.node.getWorldPosition(new Vector3());
    return { placementId: placement.placementId, assetId: placement.assetId,
      anchor: projectPoint(origin, camera, width, height),
      bounds: projectedBounds(placement.node, camera, width, height),
      visibleBounds: null, visibility: 'unknown', measurement: 'projected_box' };
  });
}
