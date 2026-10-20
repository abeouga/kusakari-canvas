import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { gardenApi } from '../api/gardens';
import { GardenHeader } from '../components/GardenHeader';
import { SiteHeader } from '../components/SiteHeader';
import { assetForObject, placedProductAsset, productAsset } from '../domain/productModels';
import { useGardenThumbnail } from '../hooks/useGardenThumbnail';
import { useGardenAutosave } from '../hooks/useGardenAutosave';
import { useSidebarWidth } from '../components/SidebarResize';
import { ObjectToolbar } from '../components/ObjectToolbar';
import { CommercePanel } from '../components/CommercePanel';
import { useCommerce } from '../hooks/useCommerce';
import { GardenDimensions } from '../components/GardenDimensions';
import { clearGardenModelCache, GardenCanvas } from '../three/GardenCanvas';
import { useEditorStore } from '../stores/editorStore';
import { PhotoOverlay } from '../components/PhotoOverlay';
import { validSurface } from '../domain/photoProjection';
import { calibratedBoundaryError } from '../domain/calibratedProjection';
import { Dialog } from '../components/Dialog';
import { UiIcon } from '../components/UiIcon';
import { CompletionImageAction } from '../components/CompletionImageAction';
import { clearPlantCompositionCache } from '../three/PlantCompositionModel';
export function EditorPage({ gardenId }) {
    const gardenQuery = useQuery({ queryKey: ['garden', gardenId], queryFn: () => gardenApi.getGarden(gardenId), staleTime: Infinity });
    const assetQuery = useQuery({ queryKey: ['assets'], queryFn: gardenApi.listAssets, staleTime: Infinity });
    const document = useEditorStore((state) => state.document);
    const commerce = useCommerce(document, assetQuery.data ?? []);
    const selectedObjectId = useEditorStore((state) => state.selectedObjectId);
    const selectedAssetId = useEditorStore((state) => state.selectedAssetId);
    const tool = useEditorStore((state) => state.tool);
    const isDirty = useEditorStore((state) => state.isDirty);
    const isSaving = useEditorStore((state) => state.isSaving);
    const isTransformDragging = useEditorStore((state) => state.isTransformDragging);
    const photoBoundaryDraft = useEditorStore((state) => state.photoBoundaryDraft);
    const isCalibrating = useEditorStore((state) => state.isCalibrating);
    const hasBoundaryDraft = photoBoundaryDraft !== null;
    const saveError = useEditorStore((state) => state.saveError);
    const failedModelIds = useEditorStore((state) => state.failedModelIds);
    const loadedModelIds = useEditorStore((state) => state.loadedModelIds);
    const markModelLoaded = useEditorStore((state) => state.markModelLoaded);
    const markModelFailed = useEditorStore((state) => state.markModelFailed);
    const clearModelFailure = useEditorStore((state) => state.clearModelFailure);
    const commandCamera = useEditorStore((state) => state.commandCamera);
    const setTool = useEditorStore((state) => state.setTool);
    const selectObject = useEditorStore((state) => state.selectObject);
    const duplicateSelected = useEditorStore((state) => state.duplicateSelected);
    const deleteSelected = useEditorStore((state) => state.deleteSelected);
    const [retryRequest, setRetryRequest] = useState(null);
    const [viewMode, setViewMode] = useState('3d');
    const initializedGarden = useRef(null);
    const [sidebarWidth, setSidebarWidth] = useSidebarWidth();
    const [propertiesCollapsed, setPropertiesCollapsed] = useState(false);
    const [dimensionsOpen, setDimensionsOpen] = useState(false);
    const [leaveOpen, setLeaveOpen] = useState(false);
    const [navigating, setNavigating] = useState(false);
    const navigationLocked = useRef(false);
    const [leaveDestination, setLeaveDestination] = useState(canvasUrl('/'));
    const allowNavigation = useRef(false);
    const captureRef = useRef(null);
    useGardenThumbnail(document, !isDirty && !isSaving && !isTransformDragging && !isCalibrating
        && !hasBoundaryDraft && loadedModelIds.length === document?.objects.length, viewMode === 'photo', captureRef);
    useEffect(() => {
        if (gardenQuery.data) {
            useEditorStore.getState().hydrate(gardenQuery.data);
            if (initializedGarden.current !== gardenQuery.data.id) {
                initializedGarden.current = gardenQuery.data.id;
                setViewMode(gardenQuery.data.photo ? 'photo' : '3d');
            }
        }
    }, [gardenQuery.data]);
    useEffect(() => {
        if (!isDirty && !hasBoundaryDraft && !isCalibrating)
            return;
        const confirmUnload = (event) => {
            if (allowNavigation.current)
                return;
            event.preventDefault();
            event.returnValue = '';
        };
        window.addEventListener('beforeunload', confirmUnload);
        return () => window.removeEventListener('beforeunload', confirmUnload);
    }, [isDirty, hasBoundaryDraft, isCalibrating]);
    useEffect(() => {
        function handleDeleteKey(event) {
            const target = event.target;
            if (useEditorStore.getState().isCalibrating)
                return;
            if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)))
                return;
            if (event.key === 'Escape' && useEditorStore.getState().selectedAssetId) {
                useEditorStore.getState().selectAsset(null);
                return;
            }
            if ((event.key === 'Delete' || event.key === 'Backspace') && !navigationLocked.current && useEditorStore.getState().selectedObjectId && !useEditorStore.getState().isTransformDragging) {
                event.preventDefault();
                useEditorStore.getState().deleteSelected();
            }
        }
        window.addEventListener('keydown', handleDeleteKey);
        return () => window.removeEventListener('keydown', handleDeleteKey);
    }, []);
    const { save, flush } = useGardenAutosave(gardenId, document, isDirty, isSaving, isTransformDragging,
        isCalibrating, hasBoundaryDraft, saveError);
    function goToList() {
        requestNavigation(canvasUrl('/'));
    }
    async function requestNavigation(url) {
        const state = useEditorStore.getState();
        if (navigationLocked.current || state.isTransformDragging) return;
        if (state.photoBoundaryDraft !== null || state.isCalibrating) {
            setLeaveDestination(url);
            setLeaveOpen(true);
            return;
        }
        navigationLocked.current = true;
        setNavigating(true);
        try {
            if (await flush()) {
                allowNavigation.current = true;
                window.location.assign(url);
            }
        } finally {
            navigationLocked.current = false;
            setNavigating(false);
        }
    }
    function retryModel(objectId) {
        const object = document?.objects.find((placed) => placed.id === objectId);
        const modelUrl = assetQuery.data?.find((asset) => asset.id === object?.assetId)?.modelUrl;
        if (modelUrl)
            clearGardenModelCache(modelUrl);
        if (object?.modelComposition) clearPlantCompositionCache(object.modelComposition);
        clearModelFailure(objectId);
        setRetryRequest((previous) => ({ objectId, sequence: previous?.objectId === objectId ? previous.sequence + 1 : 1 }));
    }
    if (gardenQuery.isLoading || !document || document.id !== gardenId) {
        return (<div className="canvas-shell">
        <GardenHeader title="庭を開いています"/>
        <div className="page-shell loading-shell">
        {gardenQuery.isLoading && <p className="notice" role="status">保存した庭をAPIから読み込んでいます…</p>}
        {gardenQuery.isError && (<div className="panel load-error">
            <p className="notice notice-error" role="alert">庭を取得できませんでした。庭ID、API、MySQLの状態を確認してください。</p>
            <button className="button button-secondary" onClick={() => gardenQuery.refetch()}>再試行</button>
            <button className="button button-secondary" onClick={() => window.location.assign(canvasUrl('/'))}>庭一覧へ戻る</button>
          </div>)}
      </div></div>);
    }
    const baseAssets = assetQuery.data ?? [];
    const products = new Map((commerce.products.data ?? []).map((product) => [product.id, product]));
    const productAssets = [...products.values()].filter((product) => product.modelComposition)
        .map((product) => productAsset(product, baseAssets)).filter(Boolean);
    const savedAssets = document.objects.filter((object) => object.modelComposition)
        .map((object) => placedProductAsset(object, baseAssets));
    const assets = [...baseAssets, ...productAssets, ...savedAssets];
    const assetMap = new Map(assets.map((asset) => [asset.id, asset]));
    const selectedObject = document.objects.find((object) => object.id === selectedObjectId) ?? null;
    const selectedAsset = selectedObject ? assetForObject(selectedObject, assetMap) ?? null : null;
    const canvasHint = hasBoundaryDraft ? '庭の輪郭をクリックで描き、始点につないで確定'
        : selectedAssetId
            ? `${assetMap.get(selectedAssetId)?.name ?? '素材'}を配置中 · 地面をクリック / Escで終了`
            : selectedObject && viewMode === 'photo' ? '矢印または配置物をドラッグして移動 · 詳細で回転・倍率を調整'
                : selectedObject && tool === 'rotate'
                    ? '円形ハンドルをドラッグして角度を調整'
                    : 'オブジェクトを選択して編集';
    const statusText = isSaving ? '保存中…' : saveError ? '保存できませんでした' : isCalibrating ? 'カメラを設定中' : hasBoundaryDraft ? '輪郭を描画中' : isDirty ? '自動保存待ち' : '保存済み';
    const savePending = isDirty || isSaving || isCalibrating || hasBoundaryDraft;
    const isEditingDisabled = navigating || isTransformDragging || isCalibrating;
    const photoReady = !hasBoundaryDraft && !isCalibrating && (!document.photo || (validSurface(document.photo) && !calibratedBoundaryError(document.photo, document.width, document.depth)));
    const editorOverlay = <ObjectToolbar document={document} assets={assets} onNavigate={requestNavigation} selectedObject={selectedObject} selectedAsset={selectedAsset} tool={tool} photoMode={viewMode === 'photo'} disabled={isEditingDisabled || hasBoundaryDraft} onSetTool={setTool} onDuplicate={duplicateSelected} onDelete={deleteSelected}/>;
    return (<div className="editor-shell canvas-shell">
      <SiteHeader onNavigate={requestNavigation} disabled={navigating || isTransformDragging}/>
      {saveError && (<div className="editor-alert notice-error" role="alert">
          <span>{saveError}</span>
          <button type="button" onClick={save} disabled={isSaving || isTransformDragging}>再試行</button>
        </div>)}
      {!photoReady && !hasBoundaryDraft && !isCalibrating && <div className="editor-alert photo-progress" role="status">写真上の庭の輪郭と実寸範囲が確定すると自動保存されます。</div>}
      {assetQuery.isError && (<div className="editor-alert notice-error" role="alert">
          <span>オブジェクトカタログを読み込めませんでした。</span>
          <button type="button" onClick={() => assetQuery.refetch()}>再試行</button>
        </div>)}
      {failedModelIds.length > 0 && (<div className="editor-alert notice-error" role="alert">
          <span>{failedModelIds.length}個のモデルを読み込めません。配置一覧から削除するか再試行してください。</span>
          {failedModelIds.map((id) => (<button key={id} type="button" onClick={() => retryModel(id)}>モデルを再試行</button>))}
        </div>)}

      <main className={`editor-layout${propertiesCollapsed ? ' inspector-hidden' : ''}`} style={/** @type {import('react').CSSProperties & {'--commerce-width': string}} */ ({ '--commerce-width': `${sidebarWidth}px` })}>
        <section className="canvas-column" aria-label="庭の3D編集エリア">
          <div className="canvas-tools" data-view-mode={viewMode}>
            <div className="document-identity">
              <button type="button" className="icon-button list-button" aria-label="← 庭一覧" title="庭一覧に戻る" onClick={goToList} disabled={isEditingDisabled}><UiIcon name="back" size={16}/></button>
              <div className="document-title"><h1 title={document.name}>{document.name}</h1></div>
              <span className="document-save-status" data-testid="save-status" role="status" aria-live="polite" title={statusText}
                data-state={saveError ? 'error' : savePending ? 'pending' : 'saved'}>
                <UiIcon name={saveError ? 'alert' : savePending ? 'clock' : 'check'} size={14}/><span className="document-save-label">{statusText}</span>
              </span>
            </div>
            <div className="view-mode-actions" role="group" aria-label="表示モード">
              <button type="button" aria-label="写真＋設計" title="写真＋設計" aria-pressed={viewMode === 'photo'} disabled={isEditingDisabled} onClick={() => setViewMode('photo')}><UiIcon name="photo"/><span>写真<span className="view-mode-suffix">＋設計</span></span></button>
              <button type="button" aria-label="3D庭" title="3D庭" aria-pressed={viewMode === '3d'} disabled={hasBoundaryDraft || isEditingDisabled} onClick={() => setViewMode('3d')}><UiIcon name="cube"/><span>3D<span className="view-mode-suffix">庭</span></span></button>
            </div>
            <div className="camera-actions">
              {viewMode === '3d' && !document.photo && <button type="button" aria-label="土台設定" title="土台設定" aria-haspopup="dialog" onClick={() => setDimensionsOpen(true)} disabled={isEditingDisabled}><UiIcon name="ruler"/><span>土台設定</span></button>}
              {viewMode === '3d' && <button type="button" aria-label="上から見る" title="上から見る" onClick={() => commandCamera('top')} disabled={isEditingDisabled}><UiIcon name="top"/><span>上から見る</span></button>}
              {viewMode === '3d' && <button type="button" aria-label="初期視点" title="初期視点" onClick={() => commandCamera('home')} disabled={isEditingDisabled}><UiIcon name="home"/><span>初期視点</span></button>}
              <button type="button" className="inspector-toggle" aria-label={propertiesCollapsed ? '商品・買い物リストパネルを表示' : '商品・買い物リストパネルを隠す'} title={propertiesCollapsed ? '商品・買い物リストを表示' : '商品・買い物リストを隠す'} aria-expanded={!propertiesCollapsed} aria-controls="properties-panel" onClick={() => setPropertiesCollapsed(!propertiesCollapsed)}><UiIcon name="panel"/><span>商品・リスト</span></button>
            </div>
          </div>
          {dimensionsOpen && viewMode === '3d' && !document.photo && <Dialog title="土台のサイズ" description="庭の中心を基準に、幅と奥行きを変更します。" closeLabel="土台設定を閉じる" onClose={() => setDimensionsOpen(false)}>
            <GardenDimensions key={`${document.id}:${document.width}:${document.depth}`} document={document} disabled={isEditingDisabled || hasBoundaryDraft}/>
          </Dialog>}
          {viewMode === 'photo' ? <PhotoOverlay document={document} assets={assets} selectedAssetId={selectedAssetId} disabled={isEditingDisabled} retryRequest={retryRequest} onModelLoaded={markModelLoaded} onModelFailed={markModelFailed} editorOverlay={editorOverlay} captureRef={captureRef}/> : assetQuery.isLoading ? (<div className="canvas-loading" role="status">アセット一覧を読み込んでいます…</div>) : (<GardenCanvas document={document} assets={assets} selectedAssetId={selectedAssetId} disabled={isEditingDisabled || hasBoundaryDraft} retryRequest={retryRequest} onModelLoaded={markModelLoaded} onModelFailed={markModelFailed} editorOverlay={editorOverlay} captureRef={captureRef}/>)}
          <CompletionImageAction key={document.id} garden={document} assets={assets} photoMode={viewMode === 'photo'} captureRef={captureRef}
            storeId={commerce.cart.data?.storeId} disabled={isEditingDisabled || hasBoundaryDraft} drawingBoundary={hasBoundaryDraft}/>
          <div className="canvas-footer">
            <span className="canvas-tool-hint" aria-live="polite">{canvasHint}</span>
            <span data-testid="model-loaded">読み込み済み: {loadedModelIds.length} / {document.objects.length}</span>
            <span>1目盛り = 1m</span>
          </div>
        </section>
        {!propertiesCollapsed && <CommercePanel document={document} assets={assets} selectedObject={selectedObject} disabled={isEditingDisabled || hasBoundaryDraft || assetQuery.isLoading || assetQuery.isError} commerce={commerce} onSelectObject={selectObject} onNavigate={requestNavigation} width={sidebarWidth} onWidthChange={setSidebarWidth}/>}
      </main>
      {leaveOpen && <Dialog title="変更を保存せずに戻りますか？" description="保存していない編集内容は破棄されます。" onClose={() => setLeaveOpen(false)} footer={<>
        <button type="button" className="button button-secondary" data-dialog-autofocus onClick={() => setLeaveOpen(false)}>編集を続ける</button>
        <button type="button" className="button button-danger" disabled={isSaving} onClick={() => { allowNavigation.current = true; window.location.assign(leaveDestination); }}>変更を破棄して戻る</button>
      </>}><p>「{document.name}」の最後に保存した状態は残ります。</p></Dialog>}
    </div>);
}
import { canvasUrl } from '../domain/urls';
