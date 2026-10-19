import { useState } from 'react';
import { dimensionError } from '../domain/gardenDimensions';
import { useEditorStore } from '../stores/editorStore';
export function GardenDimensions({ document, disabled }) {
    const [width, setWidth] = useState(String(document.width));
    const [depth, setDepth] = useState(String(document.depth));
    const [error, setError] = useState('');
    const changed = Number(width) !== document.width || Number(depth) !== document.depth;
    function apply(event) {
        event.preventDefault();
        if (disabled)
            return;
        const message = dimensionError(document, Number(width), Number(depth));
        if (message) {
            setError(message);
            return;
        }
        if (!useEditorStore.getState().resizeGarden(Number(width), Number(depth)))
            setError('操作を完了してから辺の長さを変更してください。');
        else
            setError('');
    }
    return <section className="garden-dimensions" aria-label="土台の辺の長さ">
    <svg className="dimensions-preview" viewBox="0 0 240 96" role="img" aria-label={`現在の土台：幅${document.width}m、奥行き${document.depth}m`}>
      <rect x="22" y="12" width="140" height="48" rx="3" fill="#dce6ce" stroke="#6c8460"/>
      <path d="M22 69v8m0-4h140m0-4v8M171 12h8m-4 0v48m-4 0h8" fill="none" stroke="#6c8460"/>
      <text x="92" y="92" textAnchor="middle">幅 {document.width} m</text>
      <text x="184" y="32">奥行き</text><text x="184" y="49">{document.depth} m</text>
    </svg>
    <form onSubmit={apply}>
      <div className="property-fields">
        <label htmlFor="ground-width">幅 (m)<input data-dialog-autofocus id="ground-width" type="number" min="1" max="50" step="any" value={width} disabled={disabled} required onChange={(e) => { setWidth(e.target.value); setError(''); }}/></label>
        <label htmlFor="ground-depth">奥行き (m)<input id="ground-depth" type="number" min="1" max="50" step="any" value={depth} disabled={disabled} required onChange={(e) => { setDepth(e.target.value); setError(''); }}/></label>
      </div>
      <p className="form-hint">各辺1〜50m。中心を基準に変更します。木の位置・大きさは維持します。</p>
      {document.photo && <p className="form-hint">写真の基準長方形の実寸は「写真のカメラを設定」で変更します。</p>}
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      <div className="object-actions">
        <button className="button button-primary" type="submit" disabled={disabled || !changed}>土台に適用</button>
        {changed && <button className="button button-secondary" type="button" disabled={disabled} onClick={() => { setWidth(String(document.width)); setDepth(String(document.depth)); setError(''); }}>入力を戻す</button>}
      </div>
      {changed && <p className="form-hint" role="status">「土台に適用」すると自動保存されます。</p>}
    </form>
  </section>;
}
