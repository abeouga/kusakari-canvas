import { edgeLength } from '../domain/polygonEdges';
export function PhotoEdges({ document, selected, disabled, onSelect }) {
    const photo = document.photo;
    // ラベルは画像の画素単位で描くため、画像幅に比例させて画面上の大きさを揃えます。
    const labelScale = photo.imageWidth / 1000;
    return <g className="photo-edges">{photo.boundary.map((a, index) => {
            const b = photo.boundary[(index + 1) % photo.boundary.length];
            const length = edgeLength(document, index);
            const x = (a.x + b.x) * photo.imageWidth / 2, y = (a.y + b.y) * photo.imageHeight / 2;
            const dx = (b.x - a.x) * photo.imageWidth, dy = (b.y - a.y) * photo.imageHeight;
            const size = Math.max(1, Math.hypot(dx, dy)), nx = -dy / size * 7, ny = dx / size * 7;
            const hit = [[a.x * photo.imageWidth + nx, a.y * photo.imageHeight + ny], [b.x * photo.imageWidth + nx, b.y * photo.imageHeight + ny],
                [b.x * photo.imageWidth - nx, b.y * photo.imageHeight - ny], [a.x * photo.imageWidth - nx, a.y * photo.imageHeight - ny]].map((p) => p.join(',')).join(' ');
            function select(element) {
                if (disabled)
                    return;
                const svg = element.ownerSVGElement, matrix = svg.getScreenCTM();
                if (!matrix)
                    return;
                const point = new DOMPoint(x, y).matrixTransform(matrix), bounds = svg.getBoundingClientRect();
                onSelect({ index, left: Math.max(12, Math.min(point.x - bounds.left - 140, bounds.width - 292)),
                    top: Math.max(12, Math.min(point.y - bounds.top + 18, bounds.height - 330)) });
            }
            return <g key={index} className={`photo-edge${selected === index ? ' selected' : ''}${typeof photo.edgeLengths?.[index] === 'number' ? ' entered' : ''}`}>
      <line className="edge-visible" x1={a.x * photo.imageWidth} y1={a.y * photo.imageHeight} x2={b.x * photo.imageWidth} y2={b.y * photo.imageHeight} vectorEffect="non-scaling-stroke" pointerEvents="none"/>
      <polygon points={hit} data-testid={`photo-edge-${index}`} className="edge-hit" role="button" tabIndex={disabled ? -1 : 0} aria-label={`辺${index + 1}の長さを変更`} aria-disabled={disabled} aria-pressed={selected === index} vectorEffect="non-scaling-stroke" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); select(e.currentTarget); }} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                select(e.currentTarget);
            } }}/>
      <g className="edge-label" pointerEvents="none" transform={`translate(${x},${y - 14 * labelScale}) scale(${labelScale})`}>
        <rect x="-39" y="-15" width="78" height="27" rx="5"/>
        <text textAnchor="middle" y="3">{length?.toFixed(2) ?? '—'} m</text>
      </g>
      {selected === index && <circle cx={a.x * photo.imageWidth} cy={a.y * photo.imageHeight} r="9" fill="#fff" stroke="#225f51" strokeWidth="3" pointerEvents="none"/>}
    </g>;
        })}</g>;
}
