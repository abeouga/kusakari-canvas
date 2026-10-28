import { useLayoutEffect, useRef, useState } from 'react';
import { homography, unitCorners, validCorners, validSurface } from '../domain/photoProjection';
import { useEditorStore } from '../stores/editorStore';
import { PhotoCanvas } from '../three/PhotoCanvas';
import { PhotoCalibrationEditor } from './PhotoCalibrationEditor';
import { calibratedBoundaryError, cameraAlignedGrid, projectionCorners } from '../domain/calibratedProjection';
import { groundOutline } from '../domain/placementBounds';
import { PhotoEdges } from './PhotoEdges';
import { EdgeMeasurementPopover } from './EdgeMeasurementPopover';
import { groundSummary } from '../domain/gardenSummary';
import { UiIcon } from './UiIcon';
export function PhotoOverlay({ document, assets, selectedAssetId, disabled, retryRequest, onModelLoaded, onModelFailed, renderOverlay, captureRef }) {
    const svg = useRef(null);
    const fileInput = useRef(null);
    const cameraButton = useRef(null);
    const dragDepth = useRef(0);
    const [groundVisible, setGroundVisible] = useState(true);
    const [gridVisible, setGridVisible] = useState(true);
    const [objectsVisible, setObjectsVisible] = useState(true);
    const [dragging, setDragging] = useState(null);
    const draft = useEditorStore((state) => state.photoBoundaryDraft);
    const drawingBoundary = draft !== null;
    const calibrating = useEditorStore((state) => state.isCalibrating);
    const [pointer, setPointer] = useState(null);
    const [isFileDragging, setIsFileDragging] = useState(false);
    const [error, setError] = useState('');
    const [vertexError, setVertexError] = useState('');
    const [selectedEdge, setSelectedEdge] = useState(null);
    // 写真上の配置操作と、輪郭・辺の寸法の編集を切り替えます。頂点と辺は編集中だけ操作できます。
    const [editingEdges, setEditingEdges] = useState(false);
    // 画像1画素あたりの画面上の大きさ。頂点・ラベルを画像の解像度によらず同じ大きさで描きます。
    const [unit, setUnit] = useState(1);
    const photo = document.photo;
    const calibrationError = photo ? calibratedBoundaryError(photo, document.width, document.depth) : null;
    const valid = photo ? validCorners(photo.corners) : false;
    const boundaryValid = photo ? validSurface(photo) : false;
    const surfaceVisible = boundaryValid && !drawingBoundary && !calibrationError;
    const project = valid ? homography(unitCorners, projectionCorners(photo, document.width, document.depth)) : null;
    const editMode = editingEdges && boundaryValid && !drawingBoundary;
    const edgeCount = photo?.boundary.length ?? 0;
    const enteredCount = (photo?.edgeLengths ?? []).filter((length) => typeof length === 'number').length;
    let perspective = '概算';
    if (photo?.calibration) perspective = photo.calibration.method === 'edges' ? '辺の実寸から推定' : 'カメラ設定';
    useLayoutEffect(() => {
        const element = svg.current;
        if (!element)
            return undefined;
        function measure() {
            const matrix = element.getScreenCTM();
            if (matrix && matrix.a > 0)
                setUnit(1 / matrix.a);
        }
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        measure();
        return () => observer.disconnect();
    }, [photo?.dataUrl]);
    function setMode(edges) {
        setEditingEdges(edges);
        setSelectedEdge(null);
        setVertexError('');
        if (edges) {
            useEditorStore.getState().selectAsset(null);
            useEditorStore.getState().selectObject(null);
        }
    }
    function startBoundary() {
        useEditorStore.getState().setPhotoBoundaryDraft([]);
        setSelectedEdge(null);
        setPointer(null);
        setError('');
        setVertexError('');
    }
    function imagePoint(clientX, clientY) {
        const matrix = svg.current?.getScreenCTM();
        if (!matrix || !photo)
            return null;
        const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
        return { x: point.x / photo.imageWidth, y: point.y / photo.imageHeight };
    }
    function updatePoint(index, point) {
        if (!photo || disabled)
            return;
        setSelectedEdge(null);
        const next = { x: Math.max(0, Math.min(1, point.x)), y: Math.max(0, Math.min(1, point.y)) };
        const boundary = [...(draft ?? photo.boundary)];
        boundary[index] = next;
        if (drawingBoundary)
            useEditorStore.getState().setPhotoBoundaryDraft(boundary);
        else
            // 確定済みの輪郭は、成立しない形になる移動を反映せず直前の形を保ちます。
            setVertexError(useEditorStore.getState().moveBoundaryVertex(index, next) ?? '');
    }
    function finishBoundary() {
        if (disabled)
            return;
        if (!useEditorStore.getState().confirmPhotoBoundary()) {
            setError('輪郭は3〜64点必要です。線の交差、面積不足、重複や近すぎる頂点を修正してください。');
            return;
        }
        setPointer(null);
        setError('');
        // 輪郭の次は辺の実寸入力に進むため、輪郭と寸法の編集を開いたままにします。
        setEditingEdges(true);
    }
    function nearStart(point) {
        const first = draft?.[0];
        if (!first || !photo)
            return false;
        const dx = (point.x - first.x) * photo.imageWidth, dy = (point.y - first.y) * photo.imageHeight;
        return Math.hypot(dx, dy) <= 14 * unit;
    }
    async function readPhoto(file) {
        if (!file || disabled)
            return;
        setSelectedEdge(null);
        setError('');
        if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 5_000_000) {
            setError('JPEGまたはPNGを5MB以内で選択してください。');
            return;
        }
        const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
        const image = new Image();
        image.src = dataUrl;
        try {
            await image.decode();
        }
        catch {
            setError('画像を読み込めません。');
            return;
        }
        if (image.naturalWidth > 6000 || image.naturalHeight > 6000 || image.naturalWidth * image.naturalHeight > 25_000_000) {
            setError('画像は各辺6000px、総画素数2500万以下にしてください。');
            return;
        }
        useEditorStore.getState().setPhoto({ dataUrl, imageWidth: image.naturalWidth, imageHeight: image.naturalHeight, corners: [], boundary: [] });
        useEditorStore.getState().setPhotoBoundaryDraft([]);
        setPointer(null);
        setError('');
    }
    function hasFiles(event) {
        return Array.from(event.dataTransfer.types).includes('Files');
    }
    function handleFileDragEnter(event) {
        if (disabled || !hasFiles(event))
            return;
        event.preventDefault();
        dragDepth.current += 1;
        setIsFileDragging(true);
    }
    function handleFileDragOver(event) {
        if (disabled || !hasFiles(event))
            return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
    }
    function handleFileDragLeave(event) {
        if (!hasFiles(event))
            return;
        event.preventDefault();
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0)
            setIsFileDragging(false);
    }
    function handleFileDrop(event) {
        if (!hasFiles(event))
            return;
        event.preventDefault();
        dragDepth.current = 0;
        setIsFileDragging(false);
        if (disabled)
            return;
        const files = Array.from(event.dataTransfer.files);
        const file = files.find((candidate) => ['image/jpeg', 'image/png'].includes(candidate.type)) ?? files[0];
        void readPhoto(file);
    }
    function onImageClick(event) {
        if (!photo || disabled || dragging !== null || !drawingBoundary)
            return;
        const p = imagePoint(event.clientX, event.clientY);
        if (!p || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)
            return;
        if (drawingBoundary) {
            if (draft.length >= 64) {
                setError('輪郭は最大64点です。始点につないで確定するか、最後の点を戻してください。');
                return;
            }
            useEditorStore.getState().setPhotoBoundaryDraft([...draft, p]);
            setError('');
        }
    }
    const summary = editMode ? groundSummary(document) : null;
    // 写真の操作は表示領域の右上のツールバーに置き、写真の上の帯を設けません。
    // 輪郭の描画中は写真の隅を覆わないよう、ツールバーを出しません（戻す・取消は描画中の帯にあります）。
    const photoTools = photo && !drawingBoundary && <>
      {boundaryValid && <div className="photo-mode" role="group" aria-label="写真の操作">
        <button type="button" aria-pressed={!editingEdges} aria-label="配置モード" title="配置" onClick={() => setMode(false)}><UiIcon name="place" size={15}/><span className="toolbar-label">配置</span></button>
        <button type="button" aria-pressed={editingEdges} aria-label="輪郭と寸法" title="輪郭と寸法" onClick={() => setMode(true)}><UiIcon name="outline" size={15}/><span className="toolbar-label">輪郭と寸法</span><span className={`mode-badge${enteredCount === edgeCount ? ' is-complete' : ''}`}>{enteredCount}/{edgeCount}</span></button>
      </div>}
      {!boundaryValid && <button type="button" className="toolbar-text-button" disabled={disabled} onClick={startBoundary}><UiIcon name="polygon" size={15}/>庭の領域を描く</button>}
      <div className="toolbar-icons" role="group" aria-label="写真">
        <button type="button" aria-label="写真を変更" title="写真を変更" disabled={disabled} onClick={() => fileInput.current?.click()}><UiIcon name="photo-change" size={16}/></button>
        <button ref={cameraButton} type="button" aria-label="写真のカメラを設定" title="写真のカメラを設定" disabled={disabled} aria-haspopup="dialog" onClick={() => { setSelectedEdge(null); useEditorStore.getState().setCalibrating(true); }}><UiIcon name="camera" size={16}/></button>
        <button type="button" aria-label="写真を外す" title="写真を外す" disabled={disabled} onClick={() => { useEditorStore.getState().setPhoto(null); setSelectedEdge(null); setPointer(null); setError(''); }}><UiIcon name="photo-remove" size={16}/></button>
      </div>
      <div className="toolbar-icons display-toggles" role="group" aria-label="表示">
        <label title="地面"><input type="checkbox" aria-label="地面" checked={groundVisible} onChange={(event) => setGroundVisible(event.target.checked)}/><UiIcon name="ground" size={16}/></label>
        <label title="グリッド"><input type="checkbox" aria-label="グリッド" checked={gridVisible} onChange={(event) => setGridVisible(event.target.checked)}/><UiIcon name="grid" size={16}/></label>
        <label title="配置物"><input type="checkbox" aria-label="配置" disabled={disabled} checked={objectsVisible} onChange={(event) => setObjectsVisible(event.target.checked)}/><UiIcon name="tree" size={16}/></label>
      </div>
    </>;
    const pixels = (p) => ({ x: p.x * photo.imageWidth, y: p.y * photo.imageHeight });
    const projected = (p) => pixels(project(p));
    const boundaryPoints = draft ?? photo?.boundary ?? [];
    const boundary = boundaryPoints.map((p) => pixels(p)).map((p) => `${p.x},${p.y}`).join(' ');
    const activePoints = drawingBoundary ? boundaryPoints : [];
    const showVertices = drawingBoundary || editMode;
    const previewStart = activePoints.length ? pixels(activePoints[activePoints.length - 1]) : null;
    const closing = drawingBoundary && draft.length >= 3 && pointer !== null && nearStart(pointer);
    const previewEnd = pointer ? pixels(closing ? draft[0] : pointer) : null;
    const grid = [];
    if (valid && photo.calibration) {
        grid.push(...cameraAlignedGrid(photo, groundOutline(document)).map(({ a, b }) => ({ a: pixels(a), b: pixels(b) })));
    }
    else if (valid && project) {
        for (let x = 0; x <= document.width; x += 1)
            grid.push({ a: projected({ x: x / document.width, y: 0 }), b: projected({ x: x / document.width, y: 1 }) });
        for (let z = 0; z <= document.depth; z += 1)
            grid.push({ a: projected({ x: 0, y: z / document.depth }), b: projected({ x: 1, y: z / document.depth }) });
    }
    return <div className={`photo-workspace${isFileDragging ? ' is-dragging-file' : ''}`} onDragEnter={handleFileDragEnter} onDragOver={handleFileDragOver} onDragLeave={handleFileDragLeave} onDrop={handleFileDrop}>
    {calibrating && photo && <PhotoCalibrationEditor document={document} photo={photo} returnFocus={cameraButton} onClose={() => useEditorStore.getState().setCalibrating(false)}/>}
    <input ref={fileInput} type="file" accept="image/jpeg,image/png" disabled={disabled} aria-label="庭の写真を選択" onChange={(event) => { void readPhoto(event.target.files?.[0]); event.target.value = ''; }} hidden/>
    {error && <p role="alert" className="notice-error">{error}</p>}
    {vertexError && editMode && <p role="alert" className="notice-error" data-testid="vertex-error">{vertexError}</p>}
    {calibrationError && <p role="alert" className="notice-error">{calibrationError}</p>}
    {!photo && renderOverlay(null)}
    {!photo ? <button type="button" className="photo-empty" disabled={disabled} onClick={() => fileInput.current?.click()}>
      <span className="upload-symbol"><UiIcon name="photo" size={32}/></span>
      <strong>庭の写真から設計する</strong>
      <span>庭の写真を選択してください。</span>
      <span className="photo-empty-hint">クリックして選択、またはここにドラッグ＆ドロップ</span>
      <span className="upload-format">JPEG / PNG · 5MBまで</span>
    </button> : <>
      {drawingBoundary && <div className="photo-guidance photo-hint is-drawing" aria-live="polite">
        <span className="drawing-count">{draft.length}/64点</span><span>頂点を順にクリック。3点以上で始点につなぐと確定します。</span>
        {draft.length > 0 && <button type="button" className="button button-secondary" disabled={disabled} onClick={() => { useEditorStore.getState().setPhotoBoundaryDraft(draft.slice(0, -1)); setError(''); }}>最後の点を戻す</button>}
        <button type="button" className="button button-secondary" disabled={disabled} onClick={() => { useEditorStore.getState().setPhotoBoundaryDraft(null); setPointer(null); setError(''); }}>輪郭の描画を取消</button>
      </div>}
      {editMode && <div className="photo-guidance edge-toolbar" role="toolbar" aria-label="輪郭と寸法の編集">
        <span className="edge-progress" data-testid="edge-progress"><strong>{enteredCount}/{edgeCount}辺</strong>入力済み</span>
        <span className="edge-perspective">パース：{perspective}</span>
        {summary.area !== null && <span className="edge-area" data-testid="ground-summary" title={summary.label}>面積 {summary.area.toFixed(2)} m²・外周 {summary.perimeter.toFixed(2)} m{!photo.calibration && `（${summary.label}）`}</span>}
        <button type="button" className="button button-secondary" disabled={disabled} onClick={startBoundary}><UiIcon name="redraw" size={14}/>庭の領域を書き直す</button>
        <button type="button" className="button button-primary" onClick={() => setMode(false)}><UiIcon name="check" size={14}/>完了</button>
      </div>}
      <div className="photo-stage-shell">
      {renderOverlay(photoTools)}
      <svg ref={svg} className="photo-stage" viewBox={`0 0 ${photo.imageWidth} ${photo.imageHeight}`} onClick={onImageClick} onPointerMove={(event) => { if (disabled)
            return; const p = imagePoint(event.clientX, event.clientY); if (!p)
            return; if (dragging !== null)
            updatePoint(dragging, p);
        else
            setPointer(p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1 ? p : null); }} onPointerLeave={() => setPointer(null)} onPointerUp={() => setDragging(null)} onPointerCancel={() => { setDragging(null); setPointer(null); }}>
        <image href={photo.dataUrl} width={photo.imageWidth} height={photo.imageHeight}/>
        {surfaceVisible && <defs><clipPath id="garden-photo-boundary"><polygon points={boundary}/></clipPath></defs>}
        {surfaceVisible && groundVisible && <polygon data-testid="photo-ground" points={boundary} fill="#74b780" fillOpacity="0.16" stroke="#d9ee87" strokeWidth={2 * unit}/>}
        {valid && surfaceVisible && gridVisible && <g clipPath="url(#garden-photo-boundary)">{grid.map(({ a, b }, i) => <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#e9f7be" strokeOpacity="0.85" strokeWidth={unit}/>)}</g>}
        {surfaceVisible && <foreignObject width={photo.imageWidth} height={photo.imageHeight}>
          <PhotoCanvas document={document} assets={assets} selectedAssetId={selectedAssetId} disabled={disabled || editMode} objectsVisible={objectsVisible} retryRequest={retryRequest} onModelLoaded={onModelLoaded} onModelFailed={onModelFailed} captureRef={captureRef}/>
        </foreignObject>}
        {boundaryPoints.length > 1 && <polyline points={boundary} fill="none" stroke="#ffbd68" strokeWidth={(showVertices ? 2 : 1.5) * unit} pointerEvents="none"/>}
        {editMode && <PhotoEdges document={document} unit={unit} selected={selectedEdge?.index ?? null} disabled={disabled} onSelect={setSelectedEdge}/>}
        {previewStart && previewEnd && dragging === null && !disabled && <line data-testid="photo-preview-edge" x1={previewStart.x} y1={previewStart.y} x2={previewEnd.x} y2={previewEnd.y} stroke={closing ? '#d9ee87' : '#ffbd68'} strokeWidth={2 * unit} strokeDasharray={`${7 * unit} ${5 * unit}`} pointerEvents="none"/>}
        {showVertices && boundaryPoints.map((point, index) => {
                const p = pixels(point);
                const start = drawingBoundary && index === 0;
                return <g key={`b${index}`}>
          {start && draft.length >= 3 && <circle cx={p.x} cy={p.y} r={14 * unit} fill="transparent" stroke={closing ? '#d9ee87' : '#ffbd68'} strokeWidth={2 * unit} onClick={(event) => { event.stopPropagation(); finishBoundary(); }} onPointerDown={(event) => event.stopPropagation()}/>}
          <circle data-testid={`photo-vertex-${index + 1}`} cx={p.x} cy={p.y} r={(drawingBoundary ? 9 : 7) * unit} fill="#ffbd68" stroke="#593818" strokeWidth={2 * unit} role={start ? 'button' : undefined} tabIndex={start ? 0 : undefined} aria-label={start ? '始点につないで輪郭を確定' : undefined} onKeyDown={(event) => { if (start && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault();
                    finishBoundary();
                } }} onClick={(event) => { event.stopPropagation(); if (start)
                    finishBoundary(); }} onPointerDown={(event) => { event.stopPropagation(); if (disabled || start)
                    return; setPointer(null); setDragging(index); event.currentTarget.setPointerCapture(event.pointerId); }}/>
          {drawingBoundary && <text data-testid="photo-vertex-number" x={p.x} y={p.y + 3.5 * unit} textAnchor="middle" fontSize={10 * unit} fill="#593818" pointerEvents="none">{index + 1}</text>}
        </g>;
            })}
      </svg>
      {selectedEdge && editMode && <EdgeMeasurementPopover key={`${selectedEdge.index}:${photo.boundary.map((p) => `${p.x},${p.y}`).join(';')}`} document={document} selection={selectedEdge} onClose={() => setSelectedEdge(null)} onNavigate={(index, notice) => setSelectedEdge({ ...selectedEdge, index, notice })}/>}
      </div>
    </>}
  </div>;
}
