import { groundPoint } from './calibratedProjection';
import { homography, unitCorners } from './photoProjection';
export function photoGroundPoint(photo, width, depth, point) {
    if (photo.calibration)
        return groundPoint(photo, point);
    const inverse = homography(photo.corners, unitCorners);
    if (!inverse)
        return null;
    const frame = photo.projectionSize ?? { width, depth }, p = inverse(point);
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y))
        return null;
    return { x: (p.x - 0.5) * frame.width, z: (0.5 - p.y) * frame.depth };
}
export function edgeLength(document, index) {
    const photo = document.photo;
    if (!photo || !Number.isInteger(index) || index < 0 || index >= photo.boundary.length)
        return null;
    // 利用者が入力した辺の実寸を正本として表示します。未入力の辺だけ現在の投影から計測します。
    const entered = photo.edgeLengths?.length === photo.boundary.length ? photo.edgeLengths[index] : null;
    if (entered !== null)
        return entered;
    const a = photoGroundPoint(photo, document.width, document.depth, photo.boundary[index]);
    const b = photoGroundPoint(photo, document.width, document.depth, photo.boundary[(index + 1) % photo.boundary.length]);
    const length = a && b ? Math.hypot(b.x - a.x, b.z - a.z) : null;
    return Number.isFinite(length) ? length : null;
}
