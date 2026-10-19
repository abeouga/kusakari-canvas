import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { UiIcon } from './UiIcon';
export function Dialog({ title, description = null, children, footer = null, onClose, className = '', busy = false, closeLabel = '閉じる', returnFocus = null }) {
    const ref = useRef(null);
    const opener = useRef(null);
    const titleId = useId(), descriptionId = useId();
    useEffect(() => {
        const dialog = ref.current;
        if (!opener.current)
            opener.current = returnFocus?.current ?? document.activeElement;
        dialog.showModal();
        dialog.querySelector('[data-dialog-autofocus]')?.focus();
        return () => {
            dialog.close();
            requestAnimationFrame(() => { if (!dialog.open && opener.current instanceof HTMLElement && opener.current.isConnected)
                opener.current.focus(); });
        };
    }, []);
    return createPortal(<dialog ref={ref} className={`app-dialog ${className}`} aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} aria-busy={busy} onCancel={(event) => { event.preventDefault(); if (!busy)
        onClose(); }} onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key !== 'Tab')
                return;
            const focusable = [...event.currentTarget.querySelectorAll('button, input, select, textarea, summary, a[href], [tabindex]')]
                .filter((element) => element instanceof HTMLElement)
                .filter((element) => !element.matches(':disabled') && element.tabIndex >= 0 && element.getClientRects().length > 0);
            const first = focusable[0], last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
            }
            else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
            }
        }}>
    <header className="dialog-header">
      <div><h2 id={titleId}>{title}</h2>{description && <p id={descriptionId}>{description}</p>}</div>
      <button type="button" className="icon-button" aria-label={closeLabel} disabled={busy} onClick={onClose}><UiIcon name="close"/></button>
    </header>
    <div className="dialog-body">{children}</div>
    {footer && <footer className="dialog-footer">{footer}</footer>}
  </dialog>, document.body);
}
