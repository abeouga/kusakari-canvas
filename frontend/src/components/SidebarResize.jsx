import { useState } from 'react';

const key = 'kusakari.canvas.sidebarWidth';
export function useSidebarWidth() {
  const [width, setWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(key));
      if (saved >= 280 && saved <= 560) return saved;
    } catch { /* Browser preferences may be unavailable. */ }
    return 360;
  });
  function change(value) {
    const next = Math.min(560, Math.max(280, Math.round(value)));
    setWidth(next);
    try { localStorage.setItem(key, String(next)); } catch { /* Resizing still works without persistence. */ }
  }
  return [width, change];
}
export function SidebarResize({ width, onChange }) {
  const [start, setStart] = useState(null);
  function keyDown(event) {
    let next;
    if (event.key === 'ArrowLeft') next = width + 20;
    if (event.key === 'ArrowRight') next = width - 20;
    if (event.key === 'Home') next = 280;
    if (event.key === 'End') next = 560;
    if (next === undefined) return;
    event.preventDefault();
    onChange(next);
  }
  return <div className="sidebar-resize" role="separator" aria-label="商品サイドバーの幅"
    aria-orientation="vertical" aria-valuemin={280} aria-valuemax={560} aria-valuenow={width} tabIndex={0}
    onKeyDown={keyDown} onPointerDown={(event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setStart({ x: event.clientX, width });
    }} onPointerMove={(event) => { if (start) onChange(start.width + start.x - event.clientX); }}
    onPointerUp={(event) => { setStart(null); event.currentTarget.releasePointerCapture(event.pointerId); }}
    onPointerCancel={() => setStart(null)}><span/></div>;
}
