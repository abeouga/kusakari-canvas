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

export function shoppingUrl(rows) {
  if (rows.length === 0) throw new Error("庭に素材を配置してください。");
  const items = [];
  for (const row of rows) {
    if (!row.materialCode)
      throw new Error(`${row.name}には対応商品がありません。`);
    if (row.quantity > 99)
      throw new Error("一度に購入候補へ渡せる数量は、素材ごとに99点までです。");
    items.push({
      materialCode: row.materialCode,
      quantity: row.quantity,
      unit: "piece",
    });
  }
  const url = new URL("/materials", ecUrl);
  url.hash = new URLSearchParams({
    "canvas-items": JSON.stringify(items),
  }).toString();
  return url.href;
}
