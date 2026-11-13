import { useEffect, useRef, useState } from 'react';
import { placedProductIds, removedPlacements } from '../domain/productAvailability';
import { useEditorStore } from '../stores/editorStore';

/**
 * 庭を開いたときに1回だけ、戻らない理由で買えなくなった商品の配置を外します。保存は自動保存に任せます。
 * EC の照会に失敗したときは、買えるかどうかが分からないので配置を外しません。
 * @param {string} gardenId
 * @param {import('../types/garden').GardenDocument | null} document
 * @param {import('@tanstack/react-query').UseQueryResult<any[]>} references
 */
export function useUnavailablePlacements(gardenId, document, references) {
  const checked = useRef(null);
  const [removed, setRemoved] = useState(/** @type {string[]} */ ([]));
  useEffect(() => {
    if (!document || document.id !== gardenId || checked.current === gardenId) return;
    const ids = placedProductIds(document);
    if (ids.length === 0 || references.isError) {
      checked.current = gardenId;
      return;
    }
    if (!references.isSuccess || references.isPlaceholderData) return;
    const found = new Map(references.data.map((reference) => [reference.id, reference]));
    if (!ids.every((id) => found.has(id))) return;
    checked.current = gardenId;
    const result = removedPlacements(document, found);
    if (result.objectIds.length && useEditorStore.getState().removeObjects(result.objectIds)) setRemoved(result.names);
  }, [gardenId, document, references.isError, references.isSuccess, references.isPlaceholderData, references.data]);
  return { removed, dismiss: () => setRemoved([]) };
}
