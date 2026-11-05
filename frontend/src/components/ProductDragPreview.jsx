import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';

// ドラッグ中の商品タイル。ブラウザ標準のゴースト画像の代わりに、ポインターに追従して表示します。
const useDragPreview = create(() => ({ item: null, x: 0, y: 0 }));
const blank = new Image();
blank.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
// The tile keeps the grab point under the pointer, as the card was picked up.
const grab = { x: 28, y: 28 };

export function showDragPreview(event, item) {
  event.dataTransfer.setDragImage(blank, 0, 0);
  useDragPreview.setState({ item, x: event.clientX, y: event.clientY });
}

export function ProductDragPreview() {
  const { item, x, y } = useDragPreview();
  useEffect(() => {
    if (!item) return undefined;
    function move(event) {
      // Some browsers report 0,0 on the final drag event; keep the last real position.
      if (event.clientX || event.clientY) useDragPreview.setState({ x: event.clientX, y: event.clientY });
    }
    function end() { useDragPreview.setState({ item: null }); }
    window.document.addEventListener('drag', move, true);
    window.document.addEventListener('dragover', move, true);
    window.document.addEventListener('drop', end, true);
    window.document.addEventListener('dragend', end, true);
    return () => {
      window.document.removeEventListener('drag', move, true);
      window.document.removeEventListener('dragover', move, true);
      window.document.removeEventListener('drop', end, true);
      window.document.removeEventListener('dragend', end, true);
    };
  }, [item]);
  if (!item) return null;
  return createPortal(<div className="product-drag-tile" data-testid="product-drag-tile" aria-hidden="true"
    style={{ transform: `translate(${x - grab.x}px, ${y - grab.y}px)` }}>
    {item.imageUrl && <img src={item.imageUrl} alt="" draggable={false}/>}
    <strong>{item.name}</strong>
  </div>, window.document.body);
}
