import { useId, useRef, useState } from 'react';
import '../before-after.css';

export function BeforeAfterComparison({ beforeDataUrl, afterDataUrl, width, height }) {
  const [position, setPosition] = useState(50);
  const [failedBefore, setFailedBefore] = useState(null);
  const [failedAfter, setFailedAfter] = useState(null);
  const activePointer = useRef(null);
  const inputRef = useRef(null);
  const inputId = useId();
  const descriptionId = useId();
  const remainingRight = 100 - position;
  const beforeClip = `inset(0 ${remainingRight}% 0 0)`;
  const frameStyle = {
    aspectRatio: `${width} / ${height}`,
    '--comparison-aspect': width / height,
    '--comparison-position': `${position}%`,
  };
  const imageFailed = failedBefore === beforeDataUrl || failedAfter === afterDataUrl;

  function updateFromPointer(event) {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0) return;
    const offset = event.clientX - bounds.left;
    const percentage = Math.round(offset / bounds.width * 100);
    const boundedPosition = Math.min(100, Math.max(0, percentage));
    setPosition(boundedPosition);
  }

  function startDragging(event) {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    activePointer.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    updateFromPointer(event);
    inputRef.current?.focus({ preventScroll: true });
  }

  function drag(event) {
    if (activePointer.current !== event.pointerId) return;
    updateFromPointer(event);
  }

  function stopDragging(event) {
    if (activePointer.current !== event.pointerId) return;
    activePointer.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function leaveFrame(event) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
      activePointer.current = null;
    }
  }

  function changePosition(event) {
    setPosition(Number(event.target.value));
  }

  if (imageFailed) {
    return <p role="alert" data-testid="comparison-error">
      比較画像を読み込めませんでした。Before／Afterの比較は表示できません。
    </p>;
  }

  return <section className="before-after-comparison" data-testid="before-after-comparison" aria-label="庭のBefore／After比較">
    <div className="before-after-frame" style={frameStyle}
      onPointerDown={startDragging} onPointerMove={drag} onPointerUp={stopDragging}
      onPointerCancel={stopDragging} onLostPointerCapture={stopDragging} onPointerLeave={leaveFrame}>
      <img className="before-after-image" src={afterDataUrl} width={width} height={height}
        alt="After：AIが生成した庭の完成イメージ" draggable={false}
        onError={() => setFailedAfter(afterDataUrl)} data-testid="comparison-after"/>
      <img className="before-after-image" src={beforeDataUrl} width={width} height={height}
        style={{ clipPath: beforeClip }} alt="Before：庭写真に3D配置を合成した画像" draggable={false}
        onError={() => setFailedBefore(beforeDataUrl)} data-testid="comparison-before"/>
      <span className="before-after-label before-after-label-before">Before</span>
      <span className="before-after-label before-after-label-after">After</span>
      <span className="before-after-divider" aria-hidden="true"/>
      <span className="before-after-handle" data-testid="comparison-handle" aria-hidden="true">↔</span>
    </div>
    <label className="before-after-control" htmlFor={inputId}>Before／Afterの比較位置</label>
    <input className="before-after-range" ref={inputRef} id={inputId} type="range" min="0" max="100" step="1"
      value={position} onChange={changePosition} aria-label="Before／Afterの比較位置"
      aria-describedby={descriptionId} aria-valuetext={`Before ${position}%、After ${remainingRight}%`}/>
    <p className="before-after-help" id={descriptionId}>
      ドラッグして比較
    </p>
  </section>;
}
