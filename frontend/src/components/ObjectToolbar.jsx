import { useEffect, useRef } from 'react';
import { MAX_OBJECT_SCALE, MIN_OBJECT_SCALE } from '../domain/limits';
import { useEditorStore } from '../stores/editorStore';
import { UiIcon } from './UiIcon';

// 表示領域の右上の操作。写真表示では写真の操作（leading）を先頭に置き、配置物を選択した時だけ詳細を出します。
export function ObjectToolbar({ document, leading, selectedObject, selectedAsset, tool, photoMode, disabled, onSetTool, onDuplicate, onDelete }) {
    const editError = useEditorStore((state) => state.editError);
    const root = useRef(null);
    const visible = Boolean(leading) || Boolean(selectedObject) || Boolean(editError);
    const details = useRef(null);
    const trigger = useRef(null);
    useEffect(() => {
        function closeOutside(event) {
            if (details.current && !details.current.contains(event.target)) details.current.open = false;
        }
        const surface = root.current?.parentElement;
        const resize = new ResizeObserver(() => {
            if (surface) surface.style.setProperty('--editing-height', `${surface.clientHeight}px`);
        });
        if (surface) resize.observe(surface);
        window.document.addEventListener('pointerdown', closeOutside);
        return () => { resize.disconnect(); window.document.removeEventListener('pointerdown', closeOutside); };
    }, [visible]);
    function handleKey(event) {
        event.stopPropagation();
        if (event.key === 'Escape' && details.current?.open) {
            event.preventDefault();
            details.current.open = false;
            trigger.current?.focus();
        }
    }
    function updatePosition(axis, raw) {
        if (!selectedObject)
            return;
        const value = Number(raw);
        if (!Number.isFinite(value))
            return;
        const current = selectedObject.position;
        const transform = {
            position: { x: axis === 'x' ? value : current.x, y: 0, z: axis === 'z' ? value : current.z },
            rotation: { ...selectedObject.rotation },
            scale: { ...selectedObject.scale },
        };
        useEditorStore.getState().transformObject(selectedObject.id, transform);
    }
    function updateRotation(raw) {
        if (!selectedObject)
            return;
        const degrees = Number(raw);
        if (!Number.isFinite(degrees))
            return;
        useEditorStore.getState().transformObject(selectedObject.id, {
            position: { ...selectedObject.position },
            rotation: { x: 0, y: degrees * Math.PI / 180, z: 0 },
            scale: { ...selectedObject.scale },
        });
    }
    function resetRotation() {
        updateRotation('0');
    }
    function updateScale(raw) {
        if (!selectedObject)
            return;
        const value = Number(raw);
        if (!Number.isFinite(value))
            return;
        useEditorStore.getState().transformObject(selectedObject.id, {
            position: { ...selectedObject.position },
            rotation: { ...selectedObject.rotation },
            scale: { x: value, y: value, z: value },
        });
    }
    // 操作する対象がない時は、表示領域を覆う空のツールバーを出しません。
    if (!visible)
        return null;
    return <div ref={root} className="object-toolbar" aria-label="庭と配置物の編集" data-testid="object-toolbar"
      onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()} onKeyDown={handleKey}>
            {leading}
            {selectedObject && !photoMode && <div className="transform-tools" role="group" aria-label="変形ツール">
              <button type="button" data-testid="tool-move" aria-pressed={tool === 'move'} disabled={disabled} onClick={() => onSetTool('move')}><UiIcon name="move" size={15}/>移動</button>
              <button type="button" data-testid="tool-rotate" aria-pressed={tool === 'rotate'} disabled={disabled} onClick={() => onSetTool('rotate')}><UiIcon name="rotate" size={15}/>回転</button>
              <button type="button" data-testid="tool-scale" aria-pressed={tool === 'scale'} disabled={disabled} onClick={() => onSetTool('scale')}><UiIcon name="scale" size={15}/>拡縮</button>
            </div>}
      {editError && <p className="notice notice-error" role="alert">{editError}</p>}
      {selectedObject && <details ref={details} className="object-details">
        <summary ref={trigger} data-testid="object-details-toggle" aria-disabled={disabled}
          onClick={(event) => { if (disabled) event.preventDefault(); }}><UiIcon name="settings" size={15}/><span className="toolbar-label">詳細</span></summary>
        <div className="object-details-content">
          <div className="selection-name"><strong>{selectedAsset?.name ?? '不明なアセット'}</strong></div>
          <div className="property-fields">
            <label htmlFor="position-x">X座標 (m)
              <input id="position-x" data-testid="position-x" type="number" step="0.1" min={-document.width / 2} max={document.width / 2} value={Number(selectedObject.position.x.toFixed(2))} disabled={disabled} onChange={(event) => updatePosition('x', event.target.value)}/>
            </label>
            <label htmlFor="position-z">Z座標 (m)
              <input id="position-z" data-testid="position-z" type="number" step="0.1" min={-document.depth / 2} max={document.depth / 2} value={Number(selectedObject.position.z.toFixed(2))} disabled={disabled} onChange={(event) => updatePosition('z', event.target.value)}/>
            </label>
            <div className="rotation-field">
              <label htmlFor="rotation-y">Y回転 (度)
                <input id="rotation-y" data-testid="rotation-y" type="number" step="1" value={Number((selectedObject.rotation.y * 180 / Math.PI).toFixed(1))} disabled={disabled} onChange={(event) => updateRotation(event.target.value)}/>
              </label>
              <button className="angle-reset" type="button" aria-label="角度を0度に戻す" disabled={disabled || selectedObject.rotation.y === 0} onClick={resetRotation}>0°へ戻す</button>
            </div>
            <label htmlFor="uniform-scale">倍率 (一様)
              <input id="uniform-scale" data-testid="uniform-scale" type="number" min={MIN_OBJECT_SCALE} max={MAX_OBJECT_SCALE} step="0.05" value={Number(selectedObject.scale.x.toFixed(2))} disabled={disabled} onChange={(event) => updateScale(event.target.value)}/>
            </label>
          </div>
          <p className="form-hint">{photoMode ? '数値で位置・回転・倍率を調整します。' : tool === 'rotate' ? '円形ハンドルをドラッグして回転します。' : tool === 'move' ? '配置物をドラッグして位置を調整します。' : `倍率は ${MIN_OBJECT_SCALE}〜${MAX_OBJECT_SCALE} の範囲で変更できます。`}</p>
          <div className="object-actions">
            <button className="button button-secondary" type="button" disabled={disabled || document.objects.length >= 200} onClick={onDuplicate}><UiIcon name="copy" size={15}/>複製</button>
            <button className="button button-danger-subtle" type="button" disabled={disabled} onClick={onDelete}><UiIcon name="trash" size={15}/>削除</button>
          </div>
        </div>
      </details>}
    </div>;
}
