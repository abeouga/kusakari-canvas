import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { UiIcon } from './UiIcon';

// iマークの補足。ホバー・フォーカスで表示し、クリックで固定します。
// サイドバーやキャンバスの重なりに隠れないよう、body直下に最前面で表示します。
export function InfoTip({ label, children }) {
  const id = useId();
  const button = useRef(null);
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [position, setPosition] = useState(null);
  const open = hovered || pinned;
  useEffect(() => {
    if (!open) return undefined;
    function place() {
      const rect = button.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(260, window.innerWidth - 24);
      const left = Math.min(Math.max(12, rect.right - width), window.innerWidth - width - 12);
      setPosition({ top: rect.bottom + 8, left, width });
    }
    function close(event) {
      if (event.type === 'keydown' && event.key !== 'Escape') return;
      if (event.type === 'pointerdown' && button.current?.contains(event.target)) return;
      setPinned(false);
      setHovered(false);
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    // Capture phase: the sidebar stops key events from bubbling past it.
    window.document.addEventListener('pointerdown', close, true);
    window.document.addEventListener('keydown', close, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      window.document.removeEventListener('pointerdown', close, true);
      window.document.removeEventListener('keydown', close, true);
    };
  }, [open]);
  return <>
    <button ref={button} type="button" className="info-tip-trigger" aria-label={label} aria-expanded={open}
      aria-describedby={open ? id : undefined} onClick={() => setPinned((value) => !value)}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)} onBlur={() => setHovered(false)}>
      <UiIcon name="info" size={16}/>
    </button>
    {open && position && createPortal(<div id={id} role="tooltip" className="info-tip"
      style={{ top: position.top, left: position.left, width: position.width }}>{children}</div>, window.document.body)}
  </>;
}
