import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { edgeLength } from '../domain/polygonEdges';
import { useEditorStore } from '../stores/editorStore';
import { UiIcon } from './UiIcon';

function formatLength(length) {
  if (!Number.isFinite(length)) return '';
  return String(Number(length.toFixed(6)));
}

export function EdgeMeasurementPopover({ document, selection, onClose }) {
  const length = edgeLength(document, selection.index);
  const panel = useRef(null);
  const input = useRef(null);
  const [value, setValue] = useState(() => formatLength(length));
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [position, setPosition] = useState({ left: selection.left, top: selection.top });
  const locked = useEditorStore((state) => state.isCalibrating || state.isTransformDragging || state.photoBoundaryDraft !== null);
  const measurable = Number.isFinite(length) && length > 0.000001;
  const entered = typeof document.photo.edgeLengths?.[selection.index] === 'number';
  const remaining = document.photo.boundary.length - (document.photo.edgeLengths ?? []).filter((item) => typeof item === 'number').length;

  useEffect(() => {
    const element = panel.current;
    const ownerDocument = element.ownerDocument;
    function dismissOutside(event) {
      if (!event.isPrimary || event.button !== 0 || element.contains(event.target)) return;
      // 背景操作とそのフォーカスを維持し、未適用値だけを破棄します。
      onClose();
    }
    ownerDocument.addEventListener('pointerdown', dismissOutside, true);
    return () => ownerDocument.removeEventListener('pointerdown', dismissOutside, true);
  }, [onClose]);

  useLayoutEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  useLayoutEffect(() => {
    const element = panel.current;
    const container = element.parentElement;
    const svg = container.querySelector('svg.photo-stage');
    const photo = document.photo;
    const a = photo.boundary[selection.index];
    const b = photo.boundary[(selection.index + 1) % photo.boundary.length];
    function place() {
      const matrix = svg.getScreenCTM();
      if (!matrix) return;
      const bounds = container.getBoundingClientRect();
      const anchor = new DOMPoint((a.x + b.x) * photo.imageWidth / 2, (a.y + b.y) * photo.imageHeight / 2).matrixTransform(matrix);
      const x = anchor.x - bounds.left;
      const y = anchor.y - bounds.top;
      const left = x < bounds.width / 2 ? x + 20 : x - element.offsetWidth - 20;
      setPosition({
        left: Math.max(12, Math.min(left, bounds.width - element.offsetWidth - 12)),
        top: Math.max(12, Math.min(y - element.offsetHeight / 2, bounds.height - element.offsetHeight - 12)),
      });
    }
    const observer = new ResizeObserver(place);
    observer.observe(container);
    observer.observe(element);
    place();
    return () => observer.disconnect();
  }, [document.photo, selection.index]);

  function close() {
    onClose();
    requestAnimationFrame(() => {
      const edge = window.document.querySelector(`[data-testid="photo-edge-${selection.index}"]`);
      if (edge instanceof SVGElement) edge.focus();
    });
  }

  function apply(event) {
    event.preventDefault();
    setError('');
    setNotice('');
    if (locked) return;
    if (value.trim() === '' || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())) {
      setError('辺の長さは0より大きい数値で入力してください。');
      return;
    }
    const requestedLength = Number(value);
    const previousDocument = useEditorStore.getState().document;
    const cause = useEditorStore.getState().setPhotoEdgeLength(selection.index, requestedLength);
    if (cause) {
      setError(cause);
      return;
    }
    const next = useEditorStore.getState().document;
    setValue(formatLength(edgeLength(next, selection.index)));
    if (previousDocument === next) {
      setNotice('長さは変更されていません。');
      return;
    }
    const left = next.photo.edgeLengths.filter((item) => item === null).length;
    setNotice(left ? `長さを記録しました。残り${left}辺の長さを入力すると、写真のパースを求めます。` : '長さを適用し、写真のパースを求めました。自動保存されます。');
  }

  return <section ref={panel} className="edge-popover" role="dialog" aria-label="選択した辺の長さ" style={position}
    onPointerDown={(event) => event.stopPropagation()}
    onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); close(); } }}>
    <header>
      <div><span className="popover-caption"><UiIcon name="ruler" size={14}/>実寸を入力</span><h3>辺{selection.index + 1}の長さ</h3></div>
      <button type="button" className="icon-button" aria-label="辺の計測を閉じる" onClick={close}><UiIcon name="close" size={17}/></button>
    </header>
    <div className="edge-measurement">
      <span>{entered ? '入力した実寸' : document.photo.calibration ? '現在の実寸' : '現在の概算'}</span>
      <output data-testid="edge-measurement" aria-label="辺の計測値">{measurable ? `${length.toFixed(2)} m` : '計測できません'}</output>
    </div>
    <form onSubmit={apply} noValidate>
      <label className="edge-length-field">辺の長さ（m）
        <input ref={input} type="text" inputMode="decimal" maxLength={32} value={value} disabled={locked || !measurable}
          onChange={(event) => { setValue(event.target.value); setError(''); setNotice(''); }} />
      </label>
      <p>写真上の輪郭とほかの辺の長さは変えずに、全辺の実寸から写真のパースを求めます。</p>
      {remaining > 0 && <p className="edge-warning">全{document.photo.boundary.length}辺のうち{remaining}辺が未入力です。全辺を入力するとパースを求めます。</p>}
      {!measurable && <p className="notice-error">地面上の位置を求められません。カメラ設定を確認してください。</p>}
      {error && <p role="alert" className="notice-error">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <footer>
        <button type="button" className="button button-secondary" onClick={close}>取消</button>
        <button type="submit" className="button button-primary" disabled={locked || !measurable}>長さを適用</button>
      </footer>
    </form>
  </section>;
}
