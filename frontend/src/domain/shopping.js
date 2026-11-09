import { assetForObject } from './productModels';
export const ecUrl =
  new URL(import.meta.env.VITE_KUSAKARI_EC_URL || "http://127.0.0.1:5186/", window.location.origin).href;
export const materialCodes = {
  tree_oak: "plant.oak",
  shrub_boxwood: "plant.boxwood",
  brick_paver: "garden.brick",
  bench_wood: "garden.bench",
};

export function placementRows(document, assets) {
  const rows = [];
  const assetMap = new Map(assets.map((asset) => [asset.id, asset]));
  for (const object of document.objects) {
    const key = object.productId ?? object.assetId;
    let row = rows.find((entry) => entry.assetId === key);
    if (!row) {
      const asset = assetForObject(object, assetMap);
      row = {
        key: object.productId ? `product:${object.productId}` : `asset:${object.assetId}`,
        productId: object.productId ?? null,
        assetId: key,
        name: asset?.name || object.assetId,
        materialCode: object.materialCode ?? (Object.hasOwn(materialCodes, object.assetId)
          ? materialCodes[object.assetId]
          : ""),
        footprint: 0,
        quantity: 0,
        unit: "piece",
      };
      rows.push(row);
    }
    row.quantity += 1;
    const dimensions = assetForObject(object, assetMap)?.baseDimensions;
    if (dimensions)
      row.footprint +=
        dimensions.width * dimensions.depth * object.scale.x * object.scale.z;
  }
  return rows;
}

// EC selections need at least one; a matching placement already covers it.
export function withSavedItems(rows, saved = []) {
  const merged = [...rows];
  for (const item of saved) {
    if (merged.some((row) => row.productId === item.productId)) continue;
    merged.push({ key: `product:${item.productId}`, productId: item.productId, assetId: item.productId,
      name: item.name, materialCode: "", footprint: 0, quantity: 1, unit: "piece", unplaced: true });
  }
  return merged;
}
