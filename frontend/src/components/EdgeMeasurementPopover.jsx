import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { edgeLength } from '../domain/polygonEdges';
import { useEditorStore } from '../stores/editorStore';
import { UiIcon } from './UiIcon';

function formatLength(length) {
  if (!Number.isFinite(length)) return '';
  return String(Number(length.toFixed(6)));
}

export function EdgeMeasurementPopover({ document, selection, onClose, onNavigate }) {
  const photo = document.photo;
  const count = photo.boundary.length;
  const length = edgeLength(document, selection.index);
  const panel = useRef(null);
  const input = useRef(null);
  // 未入力の辺は概算を候補として示すだけにし、入力欄は空にします。
  const [value, setValue] = useState(() => (typeof photo.edgeLengths?.[selection.index] === 'number' ? formatLength(length) : ''));
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(selection.notice ?? '');
  const [position, setPosition] = useState({ left: selection.left, top: selection.top });
  const locked = useEditorStore((state) => state.isCalibrating || state.isTransformDragging || state.photoBoundaryDraft !== null);
  const measurable = Number.isFinite(length) && length > 0.000001;
  const entries = photo.edgeLengths ?? [];
  const entered = typeof entries[selection.index] === 'number';
  const enteredCount = entries.filter((item) => typeof item === 'number').length;

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
    const a = photo.boundary[selection.index];
    const b = photo.boundary[(selection.index + 1) % count];
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
  }, [photo, selection.index, count]);

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
    const previousDocument = useEditorStore.getState().document;
    const cause = useEditorStore.getState().setPhotoEdgeLength(selection.index, Number(value));
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
    const pending = next.photo.edgeLengths.map((item, index) => (item === null ? index : -1)).filter((index) => index >= 0);
    if (pending.length) {
      // 続けて入力できるよう、次の未入力の辺へ移ります。
      const following = pending.find((index) => index > selection.index) ?? pending[0];
      onNavigate(following, `辺${selection.index + 1}を記録しました。残り${pending.length}辺を入力すると、写真のパースを求めます。`);
      return;
    }
    setNotice('全辺の実寸から写真のパースを求めました。自動保存されます。');
  }

  let caption = '現在の概算';
  if (entered) caption = '入力済み';
  else if (photo.calibration) caption = '現在の実寸';
  return <section ref={panel} className="edge-popover" role="dialog" aria-label="選択した辺の長さ" style={position}
    onPointerDown={(event) => event.stopPropagation()}
    onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); close(); } }}>
    <header>
      <div>
        <h3>辺{selection.index + 1}の長さ</h3>
        <span className="popover-caption"><UiIcon name="ruler" size={12}/>{enteredCount}/{count}辺 入力済み</span>
      </div>
      <nav aria-label="辺の切替">
        <button type="button" className="icon-button" aria-label="前の辺" onClick={() => onNavigate((selection.index + count - 1) % count)}><UiIcon name="back" size={15}/></button>
        <button type="button" className="icon-button" aria-label="次の辺" onClick={() => onNavigate((selection.index + 1) % count)}><UiIcon name="arrow" size={15}/></button>
        <button type="button" className="icon-button" aria-label="辺の計測を閉じる" onClick={close}><UiIcon name="close" size={15}/></button>
      </nav>
    </header>
    <form onSubmit={apply} noValidate>
      <span className="edge-length-field">
        <input ref={input} type="text" inputMode="decimal" maxLength={32} aria-label="辺の長さ（m）" placeholder={measurable ? length.toFixed(2) : ''} value={value} disabled={locked || !measurable}
          onChange={(event) => { setValue(event.target.value); setError(''); setNotice(''); }} />
        <span aria-hidden="true">m</span>
      </span>
      <button type="submit" className="button button-primary" aria-label="長さを適用" disabled={locked || !measurable}>適用</button>
    </form>
    <p className={`edge-measurement${entered ? ' is-entered' : ''}`}>
      <span>{caption}</span>
      <output data-testid="edge-measurement" aria-label="辺の計測値">{measurable ? `${length.toFixed(2)} m` : '計測できません'}</output>
    </p>
    {!measurable && <p className="notice-error">地面上の位置を求められません。カメラ設定を確認してください。</p>}
    {error && <p role="alert" className="notice-error">{error}</p>}
    {notice && <p role="status" className="edge-notice">{notice}</p>}
  </section>;
}
