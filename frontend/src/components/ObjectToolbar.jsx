import { useEditorStore } from '../stores/editorStore';
import { UiIcon } from './UiIcon';

// 表示領域の右上の操作。写真表示では写真の操作（leading）を先頭に置き、配置物を選択した時だけ削除を出します。
export function ObjectToolbar({ leading, selectedObject, tool, photoMode, disabled, onSetTool, onDelete }) {
    const editError = useEditorStore((state) => state.editError);
    // 操作する対象がない時は、表示領域を覆う空のツールバーを出しません。
    if (!leading && !selectedObject && !editError)
        return null;
    return <div className="object-toolbar" aria-label="庭と配置物の編集" data-testid="object-toolbar"
      onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
            {leading}
            {selectedObject && !photoMode && <div className="transform-tools" role="group" aria-label="変形ツール">
              <button type="button" data-testid="tool-move" aria-pressed={tool === 'move'} disabled={disabled} onClick={() => onSetTool('move')}><UiIcon name="move" size={15}/>移動</button>
              <button type="button" data-testid="tool-rotate" aria-pressed={tool === 'rotate'} disabled={disabled} onClick={() => onSetTool('rotate')}><UiIcon name="rotate" size={15}/>回転</button>
              <button type="button" data-testid="tool-scale" aria-pressed={tool === 'scale'} disabled={disabled} onClick={() => onSetTool('scale')}><UiIcon name="scale" size={15}/>拡縮</button>
            </div>}
      {editError && <p className="notice notice-error" role="alert">{editError}</p>}
      {selectedObject && <button className="object-delete" type="button" data-testid="object-delete" aria-label="削除" disabled={disabled} onClick={onDelete}>
        <UiIcon name="trash" size={15}/><span className="toolbar-label">削除</span></button>}
    </div>;
}
