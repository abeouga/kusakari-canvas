import { useEffect, useMemo, useRef } from 'react';
import { BufferGeometry, DoubleSide, Float32BufferAttribute, Shape, ShapeGeometry } from 'three';
import { useEditorStore } from '../stores/editorStore';
import { pointInPolygon } from '../domain/photoProjection';
import { containsAnchor, groundOutline } from '../domain/placementBounds';
export function GardenGround({ document, selectedAsset, disabled, invisible = false }) {
    const press = useRef(null);
    const isDragging = useEditorStore((state) => state.isTransformDragging);
    const outline = useMemo(() => groundOutline(document), [document.photo, document.width, document.depth]);
    const grid = useMemo(() => makeGrid(document.width, document.depth, outline), [document.width, document.depth, outline]);
    useEffect(() => () => grid.dispose(), [grid]);
    const surface = useMemo(() => {
        const shape = new Shape();
        outline.forEach((point, index) => index === 0 ? shape.moveTo(point.x, -point.z) : shape.lineTo(point.x, -point.z));
        shape.closePath();
        return new ShapeGeometry(shape);
    }, [outline]);
    useEffect(() => () => surface.dispose(), [surface]);
    function finishPlacement(event) {
        const start = press.current;
        press.current = null;
        if (!start || start.pointerId !== event.pointerId || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5)
            return;
        if (!selectedAsset || disabled || isDragging)
            return;
        if (!containsAnchor(document, event.point))
            return;
        event.stopPropagation();
        useEditorStore.getState().addAssetAt(selectedAsset, event.point.x, event.point.z);
    }
    const groundLines = useMemo(() => makeBoundary(outline), [outline]);
    useEffect(() => () => groundLines.dispose(), [groundLines]);
    return (<>
      <mesh name="garden-ground" rotation={[-Math.PI / 2, 0, 0]} position={[0, invisible ? 0 : -0.02, 0]} onPointerDown={(event) => {
            if (!selectedAsset || disabled || isDragging)
                return;
            press.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
        }} onPointerUp={finishPlacement} onPointerCancel={() => { press.current = null; }}>
        <primitive object={surface} attach="geometry"/>
        {invisible ? <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} side={DoubleSide}/> : <meshStandardMaterial color="#cbd5b8" roughness={0.98} side={DoubleSide}/>}
      </mesh>
      {!invisible && <lineSegments geometry={grid} position={[0, 0.003, 0]}>
        <lineBasicMaterial color="#8a9a79" transparent opacity={0.34}/>
      </lineSegments>}
      {!invisible && <lineSegments geometry={groundLines} position={[0, 0.004, 0]}>
        <lineBasicMaterial color="#617452"/>
      </lineSegments>}
    </>);
}
function makeGrid(width, depth, outline) {
    const positions = [];
    const halfWidth = width / 2;
    const halfDepth = depth / 2;
    const polygon = outline.map((p) => ({ x: p.x, y: p.z }));
    const addClipped = (a, b) => {
        const segments = Math.ceil(Math.hypot(a.x - b.x, a.z - b.z) * 8);
        for (let i = 0; i < segments; i++) {
            const t = (i + 0.5) / segments;
            if (!pointInPolygon({ x: a.x + (b.x - a.x) * t, y: a.z + (b.z - a.z) * t }, polygon))
                continue;
            const u = i / segments, v = (i + 1) / segments;
            positions.push(a.x + (b.x - a.x) * u, 0, a.z + (b.z - a.z) * u, a.x + (b.x - a.x) * v, 0, a.z + (b.z - a.z) * v);
        }
    };
    for (let x = Math.ceil(-halfWidth); x <= halfWidth; x += 1)
        addClipped({ x, z: -halfDepth }, { x, z: halfDepth });
    for (let z = Math.ceil(-halfDepth); z <= halfDepth; z += 1)
        addClipped({ x: -halfWidth, z }, { x: halfWidth, z });
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    return geometry;
}
function makeBoundary(outline) {
    const geometry = new BufferGeometry();
    const positions = [];
    outline.forEach((point, index) => {
        const next = outline[(index + 1) % outline.length];
        positions.push(point.x, 0, point.z, next.x, 0, next.z);
    });
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    return geometry;
}
