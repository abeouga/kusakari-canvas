import { useEffect, useMemo, useRef, useState } from "react";
import { useThree } from "@react-three/fiber";
import { MathUtils, Plane, Vector3 } from "three";
import { useEditorStore } from "../stores/editorStore";
import { RotationRing } from "./RotationRing";
import { GardenModel, SelectionOutline } from "./GardenModel";
import { PlacementControls, handleOwnsPointer } from "./PlacementControls";
export function PlacedObject({ object, asset, disabled, photoMode = false, onModelLoaded, onModelFailed }) {
    const invalidate = useThree((state) => state.invalidate);
    const scene = useThree((state) => state.scene);
    const orbit = useThree((state) => /** @type {import('three-stdlib').OrbitControls | null} */ (state.controls));
    const group = useRef(null);
    const press = useRef(null);
    const [controlEpoch, setControlEpoch] = useState(0);
    const storedTool = useEditorStore((state) => state.tool);
    const tool = photoMode ? 'move' : storedTool;
    const selected = useEditorStore((state) => state.selectedObjectId === object.id);
    const dragging = useEditorStore((state) => state.isTransformDragging);
    const setDragging = useEditorStore((state) => state.setTransformDragging);
    const horizontalPlane = useMemo(() => new Plane(new Vector3(0, 1, 0), 0), []);
    const intersection = useMemo(() => new Vector3(), []);
    const commit = () => {
        const node = group.current;
        if (!node)
            return;
        const next = {
            position: { x: node.position.x, y: 0, z: node.position.z },
            rotation: { x: 0, y: node.rotation.y, z: 0 },
            scale: { x: node.scale.x, y: node.scale.y, z: node.scale.z },
        };
        const previous = useEditorStore.getState().document?.objects.find((placed) => placed.id === object.id);
        const unchanged = previous
            && Math.abs(previous.position.x - next.position.x) < 0.0001
            && Math.abs(previous.position.z - next.position.z) < 0.0001
            && Math.abs(previous.rotation.y - next.rotation.y) < 0.0001
            && Math.abs(previous.scale.x - next.scale.x) < 0.0001;
        if (!unchanged) {
            const accepted = useEditorStore.getState().transformObject(object.id, next);
            if (!accepted && previous) {
                node.position.set(previous.position.x, 0, previous.position.z);
                node.rotation.set(0, previous.rotation.y, 0);
                node.scale.set(previous.scale.x, previous.scale.y, previous.scale.z);
            }
        }
        setDragging(false);
        invalidate();
    };
    function constrainTransform() {
        const node = group.current;
        const document = useEditorStore.getState().document;
        if (!node || !document)
            return;
        node.position.x = MathUtils.clamp(node.position.x, -document.width / 2, document.width / 2);
        node.position.y = 0;
        node.position.z = MathUtils.clamp(node.position.z, -document.depth / 2, document.depth / 2);
        node.rotation.x = 0;
        node.rotation.z = 0;
        if (tool === 'scale') {
            const size = MathUtils.clamp(node.scale.x, 0.25, 3);
            node.scale.set(size, size, size);
        }
        invalidate();
    }
    function beginObjectDrag(event) {
        event.stopPropagation();
        if (disabled || event.button !== 0 || useEditorStore.getState().isTransformDragging || handleOwnsPointer(scene, event))
            return;
        useEditorStore.getState().selectObject(object.id);
        if (tool !== 'move' || !group.current || !event.ray.intersectPlane(horizontalPlane, intersection))
            return;
        press.current = { id: event.pointerId, x: event.clientX, y: event.clientY,
            target: event.target, offset: group.current.position.clone().sub(intersection), moved: false };
        if (orbit) orbit.enabled = false;
        event.target.setPointerCapture(event.pointerId);
    }
    function moveObjectOnGround(event) {
        const start = press.current;
        if (!start || start.id !== event.pointerId || !group.current)
            return;
        event.stopPropagation();
        if (!start.moved && Math.hypot(event.clientX - start.x, event.clientY - start.y) <= 5) return;
        const document = useEditorStore.getState().document;
        if (!document || !event.ray.intersectPlane(horizontalPlane, intersection))
            return;
        start.moved = true;
        setDragging(true);
        intersection.add(start.offset);
        group.current.position.set(MathUtils.clamp(intersection.x, -document.width / 2, document.width / 2), 0, MathUtils.clamp(intersection.z, -document.depth / 2, document.depth / 2));
        invalidate();
    }
    function finishObjectDrag(event) {
        const start = press.current;
        if (!start || start.id !== event.pointerId)
            return;
        event.stopPropagation();
        releasePointer();
        if (start.moved) commit();
    }
    function releasePointer() {
        const start = press.current;
        press.current = null;
        if (!start) return;
        if (orbit) orbit.enabled = true;
        try {
            start.target.releasePointerCapture(start.id);
        }
        catch {
            // Capture may already be released by the browser when a pointer leaves the window.
        }
    }
    function cancelObjectDrag(event) {
        if (press.current?.id !== event.pointerId)
            return;
        releasePointer();
        const previous = useEditorStore.getState().document?.objects.find((placed) => placed.id === object.id);
        if (previous && group.current) {
            group.current.position.set(previous.position.x, 0, previous.position.z);
            group.current.rotation.set(0, previous.rotation.y, 0);
            group.current.scale.set(previous.scale.x, previous.scale.y, previous.scale.z);
        }
        setDragging(false);
        invalidate();
    }
    useEffect(() => {
        if (!selected)
            return;
        function cancelTransform() {
            if (!press.current && !useEditorStore.getState().isTransformDragging)
                return;
            const previous = useEditorStore.getState().document?.objects.find((placed) => placed.id === object.id);
            if (previous && group.current) {
                group.current.position.set(previous.position.x, 0, previous.position.z);
                group.current.rotation.set(0, previous.rotation.y, 0);
                group.current.scale.set(previous.scale.x, previous.scale.y, previous.scale.z);
            }
            releasePointer();
            setDragging(false);
            // The control has no pointercancel handler; remounting releases its document listeners.
            setControlEpoch((epoch) => epoch + 1);
            invalidate();
        }
        function cancelWithEscape(event) {
            if (event.key !== 'Escape' || (!press.current && !useEditorStore.getState().isTransformDragging))
                return;
            event.preventDefault();
            cancelTransform();
        }
        window.addEventListener('pointercancel', cancelTransform);
        window.addEventListener('blur', cancelTransform);
        window.addEventListener('keydown', cancelWithEscape);
        return () => {
            if (press.current) {
                releasePointer();
                setDragging(false);
            }
            window.removeEventListener('pointercancel', cancelTransform);
            window.removeEventListener('blur', cancelTransform);
            window.removeEventListener('keydown', cancelWithEscape);
        };
    }, [object.id, selected, setDragging, invalidate]);
    const content = (<group ref={group} position={[object.position.x, 0, object.position.z]} rotation={[0, object.rotation.y, 0]} scale={[object.scale.x, object.scale.y, object.scale.z]} onPointerDown={beginObjectDrag} onPointerMove={moveObjectOnGround} onPointerUp={finishObjectDrag} onPointerCancel={cancelObjectDrag}>
        <GardenModel object={object} asset={asset} onModelLoaded={onModelLoaded} onModelFailed={onModelFailed}/>
        {selected && <SelectionOutline asset={asset}/>}
    </group>);
    let editingControl = null;
    // The toolbar locks other actions during a drag; keep the active control mounted.
    if (selected && (!disabled || dragging)) {
        if (tool === 'rotate') {
            const dimensions = asset.baseDimensions;
            const diagonal = Math.hypot(dimensions.width, dimensions.depth);
            const radius = Math.max(1.4, diagonal * object.scale.x / 2 + 0.4);
            editingControl = <RotationRing target={group} position={object.position} radius={radius} onCommit={commit}/>;
        }
        else {
            let mode = 'scale';
            let showZ = false;
            if (tool === 'move') {
                mode = 'translate';
                showZ = true;
            }
            editingControl = <PlacementControls key={controlEpoch} photoMode={photoMode} object={group} mode={mode} space="local" size={1} showX showY={false} showZ={showZ} enabled={!dragging || press.current === null} onMouseDown={() => setDragging(true)} onObjectChange={constrainTransform} onMouseUp={commit}/>;
        }
    }
    return (<>
      {content}
      {/* Drei reattaches when children change; reattaching during a drag clears the active axis. */}
      <group userData={{ captureRole: 'editor' }}>{editingControl}</group>
    </>);
}
