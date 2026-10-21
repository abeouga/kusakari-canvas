import { useLayoutEffect, useRef, useState } from 'react';
import { homography, unitCorners, validCorners, validSurface, withPhotoBoundary } from '../domain/photoProjection';
import { useEditorStore } from '../stores/editorStore';
import { PhotoCanvas } from '../three/PhotoCanvas';
import { PhotoCalibrationEditor } from './PhotoCalibrationEditor';
import { calibratedBoundaryError, projectionCorners } from '../domain/calibratedProjection';
import { PhotoEdges } from './PhotoEdges';
import { EdgeMeasurementPopover } from './EdgeMeasurementPopover';
import { UiIcon } from './UiIcon';
export function PhotoOverlay({ document, assets, selectedAssetId, disabled, retryRequest, onModelLoaded, onModelFailed, editorOverlay, captureRef }) {
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
    let perspective = '概算（全辺の入力で推定）';
    if (photo?.calibration) perspective = photo.calibration.method === 'edges' ? '辺の実寸から推定済み' : '基準長方形のカメラ設定';
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
            useEditorStore.getState().setPhoto(withPhotoBoundary(photo, boundary));
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
    if (valid && project) {
        for (let x = 0; x <= document.width; x += 1)
            grid.push({ a: projected({ x: x / document.width, y: 0 }), b: projected({ x: x / document.width, y: 1 }) });
        for (let z = 0; z <= document.depth; z += 1)
            grid.push({ a: projected({ x: 0, y: z / document.depth }), b: projected({ x: 1, y: z / document.depth }) });
    }
    return <div className={`photo-workspace${isFileDragging ? ' is-dragging-file' : ''}`} onDragEnter={handleFileDragEnter} onDragOver={handleFileDragOver} onDragLeave={handleFileDragLeave} onDrop={handleFileDrop}>
    {calibrating && photo && <PhotoCalibrationEditor document={document} photo={photo} returnFocus={cameraButton} onClose={() => useEditorStore.getState().setCalibrating(false)}/>}
    <input ref={fileInput} type="file" accept="image/jpeg,image/png" disabled={disabled} aria-label="庭の写真を選択" onChange={(event) => { void readPhoto(event.target.files?.[0]); event.target.value = ''; }} hidden/>
    {photo && <div className="photo-controls">
      {!drawingBoundary && boundaryValid && <div className="photo-mode" role="group" aria-label="写真の操作">
        <button type="button" aria-pressed={!editingEdges} onClick={() => setMode(false)}><UiIcon name="move" size={15}/>配置</button>
        <button type="button" aria-pressed={editingEdges} onClick={() => setMode(true)}><UiIcon name="ruler" size={15}/>輪郭と寸法<span className={`mode-badge${enteredCount === edgeCount ? ' is-complete' : ''}`}>{enteredCount}/{edgeCount}</span></button>
      </div>}
      {!drawingBoundary && <button ref={cameraButton} type="button" className="text-button" disabled={disabled} aria-haspopup="dialog" onClick={() => { setSelectedEdge(null); useEditorStore.getState().setCalibrating(true); }}><UiIcon name="camera" size={16}/>写真のカメラを設定</button>}
      {!drawingBoundary && !boundaryValid && <button type="button" className="text-button" disabled={disabled} onClick={startBoundary}><UiIcon name="polygon" size={16}/>庭の領域を描く</button>}
      <button type="button" className="text-button photo-remove" disabled={disabled} onClick={() => { useEditorStore.getState().setPhoto(null); setSelectedEdge(null); setPointer(null); setError(''); }}>写真を外す</button>
      {drawingBoundary && draft.length > 0 && <button type="button" className="button button-secondary" disabled={disabled} onClick={() => { useEditorStore.getState().setPhotoBoundaryDraft(draft.slice(0, -1)); setError(''); }}>最後の点を戻す</button>}
      {drawingBoundary && <button type="button" className="button button-secondary" disabled={disabled} onClick={() => { useEditorStore.getState().setPhotoBoundaryDraft(null); setPointer(null); setError(''); }}>輪郭の描画を取消</button>}
      <div className="photo-display-controls"><label><input type="checkbox" checked={groundVisible} onChange={(event) => setGroundVisible(event.target.checked)}/> 地面</label>
      <label><input type="checkbox" checked={gridVisible} onChange={(event) => setGridVisible(event.target.checked)}/> グリッド</label>
      <label><input type="checkbox" disabled={disabled} checked={objectsVisible} onChange={(event) => setObjectsVisible(event.target.checked)}/> 配置</label></div>
    </div>}
    {error && <p role="alert" className="notice-error">{error}</p>}
    {calibrationError && <p role="alert" className="notice-error">{calibrationError}</p>}
    {!photo && editorOverlay}
    {!photo ? <button type="button" className="photo-empty" disabled={disabled} onClick={() => fileInput.current?.click()}>
      <span className="upload-symbol"><UiIcon name="photo" size={32}/></span>
      <strong>庭の写真から設計する</strong>
      <span>庭の写真を選択してください。</span>
      <span className="photo-empty-hint">クリックして選択、またはここにドラッグ＆ドロップ</span>
      <span className="upload-format">JPEG / PNG · 5MBまで</span>
    </button> : <>
      {drawingBoundary && <div className="photo-guidance photo-hint is-drawing" aria-live="polite">
        <span className="drawing-count">{draft.length}/64点</span><span>頂点を順にクリック。3点以上で始点につなぐと確定します。</span>
      </div>}
      {editMode && <div className="photo-guidance edge-toolbar" role="toolbar" aria-label="輪郭と寸法の編集">
        <span className="edge-progress" data-testid="edge-progress"><strong>{enteredCount}/{edgeCount}辺</strong>入力済み</span>
        <span className="edge-perspective">パース：{perspective}</span>
        <span className="edge-hint">辺をクリックして実寸を入力・頂点をドラッグして輪郭を調整</span>
        <button type="button" className="button button-secondary" disabled={disabled} onClick={startBoundary}><UiIcon name="polygon" size={14}/>庭の領域を書き直す</button>
        <button type="button" className="button button-primary" onClick={() => setMode(false)}><UiIcon name="check" size={14}/>完了</button>
      </div>}
      <div className="photo-stage-shell">
      {editorOverlay}
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
