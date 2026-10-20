import { create } from 'zustand';
import { addObject, changeObjectTransform, createPlacedObject, duplicateObject, removeObject } from '../domain/gardenEditing';
import { validSurface, withPhotoBoundary } from '../domain/photoProjection';
import { dimensionError } from '../domain/gardenDimensions';
import { scalePhotoFromEdge } from '../domain/photoScale';
export const useEditorStore = create((set, get) => ({
    document: null,
    selectedObjectId: null,
    selectedAssetId: null,
    tool: 'move',
    isDirty: false,
    isSaving: false,
    isTransformDragging: false,
    isCalibrating: false,
    setCalibrating: (isCalibrating) => set({ isCalibrating }),
    photoBoundaryDraft: null,
    saveError: null,
    editError: null,
    cameraCommand: { view: 'home', sequence: 0 },
    loadedModelIds: [],
    failedModelIds: [],
    hydrate: (document) => {
        const current = get().document;
        if (current?.id === document.id)
            return;
        set({
            document: structuredClone(document),
            selectedObjectId: document.objects[0]?.id ?? null,
            selectedAssetId: null,
            isDirty: false,
            isSaving: false,
            isTransformDragging: false,
            isCalibrating: false,
            photoBoundaryDraft: null,
            saveError: null,
            editError: null,
            loadedModelIds: [],
            failedModelIds: [],
        });
    },
    resizeGarden: (width, depth) => {
        const state = get();
        if (!state.document || state.isCalibrating || state.isTransformDragging || state.photoBoundaryDraft !== null)
            return false;
        if (dimensionError(state.document, width, depth))
            return false;
        if (width === state.document.width && depth === state.document.depth)
            return true;
        set({ document: { ...state.document, width, depth }, isDirty: true, saveError: null, editError: null });
        return true;
    },
    setPhotoEdgeLength: (index, length) => {
        const state = get();
        if (!state.document?.photo || state.isCalibrating || state.isTransformDragging || state.photoBoundaryDraft !== null)
            return 'カメラ設定・輪郭編集・配置物の移動が終わってから変更してください。';
        const result = scalePhotoFromEdge(state.document, index, length);
        if (result.error)
            return result.error;
        if (result.document !== state.document)
            set({ document: result.document, isDirty: true, saveError: null, editError: null });
        return null;
    },
    setPhoto: (photo) => {
        const state = get();
        if (!state.document)
            return;
        set({ document: { ...state.document, photo }, isDirty: true, saveError: null,
            photoBoundaryDraft: !photo || photo.dataUrl !== state.document.photo?.dataUrl ? null : state.photoBoundaryDraft });
    },
    setPhotoBoundaryDraft: (photoBoundaryDraft) => {
        const state = get();
        if (!state.document?.photo)
            return;
        set({ photoBoundaryDraft, saveError: null });
    },
    confirmPhotoBoundary: () => {
        const state = get();
        const photo = state.document?.photo;
        if (!state.document || !photo || state.photoBoundaryDraft === null)
            return false;
        const next = withPhotoBoundary(photo, state.photoBoundaryDraft);
        if (!validSurface(next))
            return false;
        set({ document: { ...state.document, photo: next }, photoBoundaryDraft: null, isDirty: true, saveError: null });
        return true;
    },
    addAssetAt: (asset, x, z) => {
        const state = get();
        if (!state.document)
            return;
        const next = addObject(state.document, createPlacedObject(asset, x, z));
        if (!next) {
            set({ editError: '配置数の上限に達したか、配置位置が範囲外です。' });
            return;
        }
        const selectedObjectId = next.objects[next.objects.length - 1].id;
        set({ document: next, selectedObjectId, isDirty: true, editError: null, saveError: null });
    },
    selectObject: (id) => set({ selectedObjectId: id }),
    selectAsset: (id) => set({ selectedAssetId: id, editError: null }),
    setTool: (tool) => set({ tool }),
    transformObject: (id, transform) => {
        const state = get();
        if (!state.document)
            return false;
        const next = changeObjectTransform(state.document, id, transform);
        if (!next) {
            set({ editError: '庭の範囲、回転軸、拡大縮小の制限内で入力してください。' });
            return false;
        }
        set({ document: next, isDirty: true, editError: null, saveError: null });
        return true;
    },
    duplicateSelected: () => {
        const state = get();
        if (!state.document || !state.selectedObjectId)
            return;
        const next = duplicateObject(state.document, state.selectedObjectId);
        if (!next) {
            set({ editError: '複製先が施工範囲外か、配置数の上限に達しています。' });
            return;
        }
        set({ document: next, selectedObjectId: next.objects[next.objects.length - 1].id, isDirty: true, editError: null, saveError: null });
    },
    deleteSelected: () => {
        const state = get();
        if (!state.document || !state.selectedObjectId)
            return;
        const next = removeObject(state.document, state.selectedObjectId);
        if (!next)
            return;
        const selectedObjectId = next.objects[0]?.id ?? null;
        set({
            document: next,
            selectedObjectId,
            loadedModelIds: state.loadedModelIds.filter((id) => id !== state.selectedObjectId),
            failedModelIds: state.failedModelIds.filter((id) => id !== state.selectedObjectId),
            isDirty: true,
            editError: null,
            saveError: null,
        });
    },
    setAssetQuantity: (assetId, quantity) => {
        const state = get();
        if (!state.document || state.isCalibrating || state.isTransformDragging || state.photoBoundaryDraft !== null) return;
        const matching = state.document.objects.filter((object) => object.assetId === assetId);
        if (!Number.isInteger(quantity) || quantity < 0 || quantity > 200 || state.document.objects.length - matching.length + quantity > 200) {
            set({ editError: '数量は0〜200の整数、配置の合計は200個までです。' });
            return;
        }
        if (matching.length === 0 || matching.length === quantity) return;
        let next = state.document;
        if (quantity < matching.length) {
            const removeIds = new Set(matching.slice(quantity).map((object) => object.id));
            next = { ...next, objects: next.objects.filter((object) => !removeIds.has(object.id)) };
        } else {
            while (next.objects.filter((object) => object.assetId === assetId).length < quantity) {
                const duplicated = duplicateObject(next, matching[0].id);
                if (!duplicated) { set({ editError: '数量を増やせません。複製先の施工範囲と配置上限を確認してください。' }); return; }
                next = duplicated;
            }
        }
        const ids = new Set(next.objects.map((object) => object.id));
        let selectedObjectId = state.selectedObjectId;
        if (!ids.has(selectedObjectId)) selectedObjectId = null;
        set({ document: next, selectedObjectId, loadedModelIds: state.loadedModelIds.filter((id) => ids.has(id)), failedModelIds: state.failedModelIds.filter((id) => ids.has(id)), isDirty: true, editError: null, saveError: null });
    },
    setSaving: (isSaving) => set({ isSaving }),
    setTransformDragging: (isTransformDragging) => set({ isTransformDragging }),
    setSaveError: (saveError) => set({ saveError }),
    setEditError: (editError) => set({ editError }),
    markSaved: (document, submitted) => set((state) => {
        if (state.document?.id !== document.id) return {};
        const newerEdits = state.document !== submitted;
        return { document: newerEdits ? { ...state.document, revision: document.revision } : structuredClone(document),
            isDirty: newerEdits, isSaving: false, saveError: null };
    }),
    commandCamera: (view) => set((state) => ({ cameraCommand: { view, sequence: state.cameraCommand.sequence + 1 } })),
    markModelLoaded: (id) => set((state) => ({
        loadedModelIds: state.loadedModelIds.includes(id) ? state.loadedModelIds : [...state.loadedModelIds, id],
        failedModelIds: state.failedModelIds.filter((failedId) => failedId !== id),
    })),
    markModelFailed: (id) => set((state) => ({
        failedModelIds: state.failedModelIds.includes(id) ? state.failedModelIds : [...state.failedModelIds, id],
        loadedModelIds: state.loadedModelIds.filter((loadedId) => loadedId !== id),
    })),
    clearModelFailure: (id) => set((state) => ({ failedModelIds: state.failedModelIds.filter((failedId) => failedId !== id) })),
}));
