import { containsAnchor } from './placementBounds';
import { MAX_PLACED_OBJECTS, MAX_OBJECT_SCALE, MIN_OBJECT_SCALE } from './limits';
export function createPlacedObject(asset, x, z) {
    const object = {
        id: crypto.randomUUID(),
        assetId: asset.placedAssetId ?? asset.id,
        position: { x, y: 0, z },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
    };
    if (asset.modelComposition) {
        object.productId = asset.productId;
        object.productName = asset.name;
        object.materialCode = asset.materialCode;
        object.modelComposition = structuredClone(asset.modelComposition);
    }
    return object;
}
export function addObject(document, object) {
    if (document.objects.length >= MAX_PLACED_OBJECTS || object.position.y !== 0)
        return null;
    if (!Number.isFinite(object.position.x) || !Number.isFinite(object.position.z))
        return null;
    if (!containsAnchor(document, object.position))
        return null;
    if (document.objects.some((placed) => placed.id === object.id))
        return null;
    return { ...document, objects: [...document.objects, object] };
}
export function changeObjectTransform(document, objectId, transform) {
    if (!isValidTransform(document, transform))
        return null;
    const exists = document.objects.some((object) => object.id === objectId);
    if (!exists)
        return null;
    return {
        ...document,
        objects: document.objects.map((object) => object.id === objectId ? { ...object, ...cloneTransform(transform) } : object),
    };
}
export function duplicateObject(document, objectId) {
    const original = document.objects.find((object) => object.id === objectId);
    if (!original || document.objects.length >= MAX_PLACED_OBJECTS)
        return null;
    const halfWidth = document.width / 2;
    const halfDepth = document.depth / 2;
    const copy = {
        ...original,
        id: crypto.randomUUID(),
        position: {
            x: Math.min(halfWidth, Math.max(-halfWidth, original.position.x + 0.5)),
            y: 0,
            z: Math.min(halfDepth, Math.max(-halfDepth, original.position.z + 0.5)),
        },
        rotation: { ...original.rotation },
        scale: { ...original.scale },
    };
    return addObject(document, copy);
}
export function removeObject(document, objectId) {
    if (!document.objects.some((object) => object.id === objectId))
        return null;
    return { ...document, objects: document.objects.filter((object) => object.id !== objectId) };
}
export function isValidTransform(document, transform) {
    const { position, rotation, scale } = transform;
    const finite = [...Object.values(position), ...Object.values(rotation), ...Object.values(scale)].every(Number.isFinite);
    return finite
        && position.y === 0
        && containsAnchor(document, position)
        && rotation.x === 0
        && rotation.z === 0
        && scale.x >= MIN_OBJECT_SCALE
        && scale.x <= MAX_OBJECT_SCALE
        && scale.x === scale.y
        && scale.x === scale.z;
}
export function withPosition(current, x, z) {
    return { ...cloneTransform(current), position: { x, y: 0, z } };
}
export function withRotation(current, radians) {
    return { ...cloneTransform(current), rotation: { x: 0, y: radians, z: 0 } };
}
export function withScale(current, value) {
    const scale = { x: value, y: value, z: value };
    return { ...cloneTransform(current), scale };
}
function cloneTransform(transform) {
    return {
        position: { ...transform.position },
        rotation: { ...transform.rotation },
        scale: { ...transform.scale },
    };
}
