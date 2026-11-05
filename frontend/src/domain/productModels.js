const legacyModels = { 'canvas-oak': 'tree_oak', 'canvas-boxwood': 'shrub_boxwood',
  'canvas-brick': 'brick_paver', 'canvas-bench': 'bench_wood' };

// Assembly rule version → GLB catalog version it places. v5 reuses the unchanged v4 parts.
const catalogForRule = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 4 };

export function productAsset(product, assets) {
  const version = product.modelComposition?.version;
  if (version in catalogForRule && product.modelComposition.catalogVersion === catalogForRule[version]) {
    return { id: `product:${product.id}`, placedAssetId: 'plant_modular', name: product.name,
      category: product.modelComposition.profile.plantType, productId: product.id,
      materialCode: product.canvasMaterialCode, modelComposition: product.modelComposition,
      baseDimensions: product.modelComposition.baseDimensions };
  }
  return assets.find((asset) => asset.id === legacyModels[product.id]) ?? null;
}

export function assetForObject(object, assetMap) {
  const asset = assetMap.get(object.assetId);
  if (!asset || !object.modelComposition) return asset;
  return { ...asset, name: object.productName, category: object.modelComposition.profile.plantType,
    baseDimensions: object.modelComposition.baseDimensions };
}

export const productDragType = 'application/x-kusakari-product';
export function placedProductAsset(object, assets) {
  if (!object.modelComposition) return assets.find((asset) => asset.id === object.assetId) ?? null;
  return { id: `saved:${object.id}`, placedAssetId: object.assetId, name: object.productName,
    category: object.modelComposition.profile.plantType, productId: object.productId,
    materialCode: object.materialCode, modelComposition: object.modelComposition,
    baseDimensions: object.modelComposition.baseDimensions };
}
export function startProductDrag(event, asset) {
  if (!asset) { event.preventDefault(); return; }
  event.dataTransfer.effectAllowed = 'copy';
  event.dataTransfer.setData(productDragType, asset.id);
}
