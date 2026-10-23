import { outsideObjects } from '../domain/placementBounds';
import { useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { gardenApi } from '../api/gardens';
import { ApiError } from '../api/http';
import { useEditorStore } from '../stores/editorStore';
import { validSurface } from '../domain/photoProjection';
import { calibratedBoundaryError } from '../domain/calibratedProjection';

function saveBlocker(state) {
  if (state.isTransformDragging || state.isCalibrating || state.photoBoundaryDraft !== null) return '編集中の操作を確定してください。';
  const garden = state.document;
  if (garden && outsideObjects(garden).length) return '施工範囲外の配置を移動または削除すると自動保存されます。';
  if (!garden?.photo) return null;
  if (!validSurface(garden.photo)) return '庭の輪郭を確定すると自動保存されます。';
  return calibratedBoundaryError(garden.photo, garden.width, garden.depth);
}

export function useGardenAutosave(gardenId, document, dirty, saving, dragging, calibrating, boundaryDraft, error) {
  const queryClient = useQueryClient();
  const inFlight = useRef(null);
  const save = useCallback(() => {
    if (inFlight.current) return inFlight.current;
    const state = useEditorStore.getState();
    if (!state.document || state.document.id !== gardenId) return Promise.resolve(false);
    if (!state.isDirty) return Promise.resolve(true);
    const blocker = saveBlocker(state);
    if (blocker) {
      state.setSaveError(blocker);
      return Promise.resolve(false);
    }
    // Retain the submitted immutable document identity to detect edits during the request.
    const submitted = state.document;
    state.setSaving(true);
    state.setSaveError(null);
    const task = (async () => {
      try {
        const saved = await gardenApi.saveGarden(structuredClone(submitted));
        useEditorStore.getState().markSaved(saved, submitted);
        queryClient.setQueryData(['garden', gardenId], saved);
        void queryClient.invalidateQueries({ queryKey: ['gardens'] });
        return true;
      } catch (reason) {
        if (useEditorStore.getState().document?.id === gardenId) {
          const message = reason instanceof ApiError && reason.code === 'OBJECT_POSITION_OUT_OF_BOUNDS'
            ? '施工範囲外の配置を移動または削除してください。'
            : reason instanceof ApiError && reason.status === 409
            ? '別の保存結果と競合しました。編集内容は保持されています。再読み込み前に変更内容を確認してください。'
            // 入力検証の拒否は通信障害ではないため、サーバーの理由をそのまま示します。
            : reason instanceof ApiError && reason.status >= 400 && reason.status < 500 && reason.status !== 401
            ? `保存できませんでした。${reason.message} 編集内容はこの画面に保持されています。`
            : '自動保存できませんでした。編集内容はこの画面に保持されています。接続を確認して再試行してください。';
          useEditorStore.getState().setSaveError(message);
        }
        return false;
      } finally {
        if (useEditorStore.getState().document?.id === gardenId) useEditorStore.getState().setSaving(false);
        inFlight.current = null;
      }
    })();
    inFlight.current = task;
    return task;
  }, [gardenId, queryClient]);

  useEffect(() => {
    const state = useEditorStore.getState();
    if (!document || document.id !== gardenId || !dirty || saving || error || saveBlocker(state)) return;
    const timer = window.setTimeout(() => { void save(); }, 500);
    return () => window.clearTimeout(timer);
  }, [gardenId, document, dirty, saving, dragging, calibrating, boundaryDraft, error, save]);

  const flush = useCallback(async () => {
    // Navigation waits for the active request and any newer draft; requests never overlap.
    do {
      if (!await save()) return false;
    } while (useEditorStore.getState().document?.id === gardenId && useEditorStore.getState().isDirty);
    return useEditorStore.getState().document?.id === gardenId;
  }, [gardenId, save]);
  return { save, flush };
}
