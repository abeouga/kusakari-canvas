import { validSurface } from './photoProjection';
import { calibratedBoundaryError } from './calibratedProjection';
import { photoGroundPoint } from './polygonEdges';

export const PLACEMENT_EPSILON = 1e-6;
export function groundOutline(document) {
    if (!document.photo) return [
        { x: -document.width / 2, z: document.depth / 2 },
        { x: document.width / 2, z: document.depth / 2 },
        { x: document.width / 2, z: -document.depth / 2 },
        { x: -document.width / 2, z: -document.depth / 2 },
    ];
    const photo = document.photo;
    if (!validSurface(photo) || calibratedBoundaryError(photo, document.width, document.depth)) return [];
    const outline = photo.boundary.map((point) => photoGroundPoint(photo, document.width, document.depth, point));
    return outline.every((point) => point && Number.isFinite(point.x) && Number.isFinite(point.z)) ? outline : [];
}
export function containsAnchor(document, position) {
    const { x, z } = position;
    const epsilon = PLACEMENT_EPSILON;
    if (!Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > document.width / 2 + epsilon || Math.abs(z) > document.depth / 2 + epsilon) return false;
    const polygon = groundOutline(document);
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[j], b = polygon[i];
        const dx = b.x - a.x, dz = b.z - a.z;
        const lengthSquared = dx * dx + dz * dz;
        const t = lengthSquared ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / lengthSquared)) : 0;
        if (Math.hypot(x - a.x - t * dx, z - a.z - t * dz) <= epsilon) return true;
        if ((a.z > z) !== (b.z > z) && x < dx * (z - a.z) / dz + a.x) inside = !inside;
    }
    return inside;
}
export function outsideObjects(document) {
    return document.objects.filter((object) => !containsAnchor(document, object.position));
}
