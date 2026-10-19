import { useEffect, useId, useRef, useState } from 'react';
import { UiIcon } from './UiIcon';

export function CompletionMenu({ photoMode, disabled, capturing, error, toggleRef, onCapture, onHistory }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const panelRef = useRef(null);
  const panelId = useId();
  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector('button:not(:disabled)')?.focus();
    function outside(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }
    function escape(event) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      toggleRef.current?.focus();
    }
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape, true);
    };
  }, [open, toggleRef]);

  function choose(action) {
    setOpen(false);
    toggleRef.current?.focus();
    action();
  }

  return <div ref={rootRef} className="completion-launcher" data-testid="completion-launcher"
    onKeyDown={(event) => event.stopPropagation()} onBlur={(event) => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
    {open && <section ref={panelRef} id={panelId} className="completion-menu" aria-label="完成イメージメニュー">
      <span className="completion-menu-heading">完成イメージ</span>
      <button type="button" className="completion-new" aria-label="完成イメージを確認" aria-haspopup="dialog"
        disabled={disabled || capturing} onClick={() => choose(onCapture)}>
        <UiIcon name={photoMode ? 'sparkles' : 'camera'}/><span>新しく作成</span><UiIcon name="arrow" size={16}/>
      </button>
      <button type="button" className="completion-history" aria-label="生成履歴" aria-haspopup="dialog"
        disabled={disabled || capturing} onClick={() => choose(onHistory)}>
        <UiIcon name="history"/><span>生成履歴</span><UiIcon name="arrow" size={16}/>
      </button>
      {error && <p className="completion-menu-error" role="alert">{error}</p>}
    </section>}
    {!open && error && <p className="completion-launcher-error" role="alert">{error}</p>}
    <button ref={toggleRef} type="button" className="completion-launch" data-testid="completion-menu-toggle"
      aria-label={photoMode ? 'AI生成メニュー' : '完成イメージメニュー'} aria-expanded={open} aria-controls={panelId}
      disabled={disabled || capturing} onClick={() => setOpen(!open)}>
      <UiIcon name={photoMode ? 'sparkles' : 'camera'}/><span>{capturing ? '準備中…' : photoMode ? 'AI生成' : '完成イメージ'}</span>
      <UiIcon name="chevron" size={14}/>
    </button>
  </div>;
}
