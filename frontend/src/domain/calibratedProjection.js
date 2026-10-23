import { homography, unitCorners } from './photoProjection';
export function projectWorld(photo, point) {
    const c = photo.calibration;
    if (!c)
        return null;
    const r = c.rotation, t = c.translation;
    const camera = [0, 1, 2].map((i) => r[3 * i] * point.x + r[3 * i + 1] * point.y + r[3 * i + 2] * point.z + t[i]);
    if (camera[2] <= 0.01)
        return null;
    return { x: 0.5 + c.focalLengthPx * camera[0] / camera[2] / photo.imageWidth,
        y: 0.5 + c.focalLengthPx * camera[1] / camera[2] / photo.imageHeight };
}
export function projectionCorners(photo, width, depth) {
    if (!photo.calibration) {
        if (!photo.projectionSize)
            return photo.corners;
        const project = homography(unitCorners, photo.corners);
        const frame = photo.projectionSize;
        return project ? unitCorners.map((p) => project({ x: (p.x - 0.5) * width / frame.width + 0.5, y: (p.y - 0.5) * depth / frame.depth + 0.5 })) : [];
    }
    const corners = [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([x, z]) => projectWorld(photo, { x: x * width / 2, y: 0, z: z * depth / 2 }));
    return corners.every((p) => p !== null) ? corners : [];
}
export function groundPoint(photo, point) {
    const c = photo.calibration;
    if (!c)
        return null;
    const ray = [(point.x - 0.5) * photo.imageWidth / c.focalLengthPx,
        (point.y - 0.5) * photo.imageHeight / c.focalLengthPx, 1];
    const origin = [0, 1, 2].map((i) => -[0, 1, 2].reduce((sum, j) => sum + c.rotation[j * 3 + i] * c.translation[j], 0));
    const direction = [0, 1, 2].map((i) => [0, 1, 2].reduce((sum, j) => sum + c.rotation[j * 3 + i] * ray[j], 0));
    if (direction[1] >= -1e-8)
        return null;
    const distance = -origin[1] / direction[1];
    return { x: origin[0] + direction[0] * distance, z: origin[2] + direction[2] * distance };
}
// 写真上のグリッドをカメラの向きに合わせた1m間隔で返します。世界座標の軸はカメラの方位と一致しないことがあり、
// 軸に沿うと写真上で斜めの格子になるためです。線は写真上の正規化座標で、輪郭の外接範囲だけを覆います。
export function cameraAlignedGrid(photo, outline) {
    const c = photo.calibration;
    const fx = c.rotation[6], fz = c.rotation[8], length = Math.hypot(fx, fz);
    if (length < 1e-6 || outline.length < 3)
        return [];
    const forward = { x: fx / length, z: fz / length }, right = { x: -forward.z, z: forward.x };
    const along = (axis) => outline.map((p) => p.x * axis.x + p.z * axis.z);
    const range = (values) => [Math.min(...values), Math.max(...values)];
    const [r0, r1] = range(along(right)), [f0, f1] = range(along(forward));
    const world = (r, f) => projectWorld(photo, { x: right.x * r + forward.x * f, y: 0, z: right.z * r + forward.z * f });
    const lines = [];
    for (let r = Math.ceil(r0); r <= r1; r += 1)
        lines.push({ a: world(r, f0), b: world(r, f1) });
    for (let f = Math.ceil(f0); f <= f1; f += 1)
        lines.push({ a: world(r0, f), b: world(r1, f) });
    return lines.filter(({ a, b }) => a && b);
}
export function calibratedBoundaryError(photo, width, depth) {
    if (!photo.calibration)
        return null;
    for (const point of photo.boundary) {
        const ground = groundPoint(photo, point);
        if (!ground)
            return '庭の輪郭が地平線を越えています。地面上に描き直してください。';
        if (Math.abs(ground.x) > width / 2 + 0.05 || Math.abs(ground.z) > depth / 2 + 0.05)
            return '庭の輪郭が庭の実寸範囲を超えています。輪郭を描き直すか、カメラの基準点を調整してください。';
    }
    return null;
}
