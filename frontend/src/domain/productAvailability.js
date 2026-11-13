// EC の商品の一括照会（POST /api/products/references）の結果から、配置した商品を今買えるかを判断します。
// 戻らない理由（削除・店舗の閉鎖・店舗の停止・組織の停止）の商品だけ、庭を開いたときに配置を外します。
// 在庫0・非公開・閉鎖予定・受付停止・商品の停止は一時的なので、配置を残して買い物リストに表示だけします。
export const REMOVED_REASONS = new Set(['DELETED', 'STORE_CLOSED', 'STORE_SUSPENDED', 'ORGANIZATION_SUSPENDED']);

/** @param {string[]} ids */
export function uniqueProductIds(ids) {
  return [...new Set(ids.filter(Boolean))].sort();
}

/** @param {{ objects: { productId?: string }[] }} document */
export function placedProductIds(document) {
  return uniqueProductIds(document.objects.map((object) => object.productId));
}

/**
 * 戻らない理由で買えなくなった商品の配置と、知らせる商品名。
 * @param {{ objects: { id: string, productId?: string, productName?: string }[] }} document
 * @param {Map<string, { name: string, unavailableReason: string | null }>} references
 */
export function removedPlacements(document, references) {
  const objectIds = [];
  const names = [];
  for (const object of document.objects) {
    const reference = object.productId ? references.get(object.productId) : undefined;
    if (!reference || !REMOVED_REASONS.has(reference.unavailableReason)) continue;
    objectIds.push(object.id);
    const name = reference.name || object.productName || object.productId;
    if (!names.includes(name)) names.push(name);
  }
  return { objectIds, names };
}

/** @param {{ purchasable: boolean, unavailableReason: string | null } | undefined} reference */
export function availabilityNote(reference) {
  if (!reference || reference.purchasable) return null;
  return reference.unavailableReason === 'OUT_OF_STOCK' ? '在庫なし' : '現在は購入できません';
}
