import { useEffect, useMemo, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { DoubleSide, Plane, Vector2, Vector3, Raycaster } from 'three';
import { useEditorStore } from '../stores/editorStore';
/** The drag angle is accumulated across atan2's branch cut, including multiple turns. */
export function RotationRing({ target, position, radius, onCommit }) {
    const { camera, gl, invalidate } = useThree();
    const controls = useThree((state) => state.controls);
    const [hovered, setHovered] = useState(false);
    const drag = useRef(null);
    const commit = useRef(onCommit);
    useEffect(() => { commit.current = onCommit; }, [onCommit]);
    const projection = useMemo(() => ({
        raycaster: new Raycaster(), pointer: new Vector2(), point: new Vector3(),
        plane: new Plane(new Vector3(0, 1, 0), 0),
    }), []);
    useEffect(() => {
        const canvas = gl.domElement;
        function cancel() {
            const current = drag.current;
            if (!current)
                return;
            drag.current = null;
            target.current.rotation.set(0, current.initial, 0);
            invalidate();
            if (canvas.hasPointerCapture(current.pointerId))
                canvas.releasePointerCapture(current.pointerId);
            useEditorStore.getState().setTransformDragging(false);
            if (controls)
                controls.enabled = true;
        }
        function move(event) {
            const current = drag.current;
            if (!current || event.pointerId !== current.pointerId)
                return;
            const rect = canvas.getBoundingClientRect();
            projection.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
            projection.raycaster.setFromCamera(projection.pointer, camera);
            if (!projection.raycaster.ray.intersectPlane(projection.plane, projection.point))
                return;
            const dx = projection.point.x - target.current.position.x;
            const dz = projection.point.z - target.current.position.z;
            // The angle at the centre is undefined; retain the last valid direction.
            if (Math.hypot(dx, dz) < radius * 0.1)
                return;
            const angle = Math.atan2(dx, dz);
            current.angle += Math.atan2(Math.sin(angle - current.last), Math.cos(angle - current.last));
            current.last = angle;
            target.current.rotation.set(0, current.angle, 0);
            invalidate();
        }
        function finish(event) {
            if (event.pointerId !== drag.current?.pointerId)
                return;
            move(event);
            drag.current = null;
            if (canvas.hasPointerCapture(event.pointerId))
                canvas.releasePointerCapture(event.pointerId);
            commit.current();
            if (controls)
                controls.enabled = true;
        }
        function key(event) { if (event.key === 'Escape')
            cancel(); }
        function begin(event) {
            if (event.button !== 0 || drag.current)
                return;
            const rect = canvas.getBoundingClientRect();
            projection.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
            projection.raycaster.setFromCamera(projection.pointer, camera);
            projection.plane.constant = -0.06;
            if (!projection.raycaster.ray.intersectPlane(projection.plane, projection.point))
                return;
            const node = target.current;
            const dx = projection.point.x - node.position.x;
            const dz = projection.point.z - node.position.z;
            if (Math.abs(Math.hypot(dx, dz) - radius) > 0.1)
                return;
            // Capture before OrbitControls receives pointerdown so it cannot start a camera drag.
            event.stopImmediatePropagation();
            drag.current = { pointerId: event.pointerId, last: Math.atan2(dx, dz),
                angle: node.rotation.y, initial: node.rotation.y };
            canvas.setPointerCapture(event.pointerId);
            if (controls)
                controls.enabled = false;
            useEditorStore.getState().setTransformDragging(true);
        }
        canvas.addEventListener('pointerdown', begin, true);
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', finish);
        window.addEventListener('pointercancel', cancel);
        window.addEventListener('blur', cancel);
        window.addEventListener('keydown', key);
        return () => {
            cancel();
            canvas.removeEventListener('pointerdown', begin, true);
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', finish);
            window.removeEventListener('pointercancel', cancel);
            window.removeEventListener('blur', cancel);
            window.removeEventListener('keydown', key);
        };
    }, [camera, gl, controls, projection, radius, target, invalidate]);
    return <group position={[position.x, 0.06, position.z]}>
    <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={1000} onPointerOver={(event) => { event.stopPropagation(); setHovered(true); }} onPointerOut={() => setHovered(false)}>
      <ringGeometry args={[radius - 0.1, radius + 0.1, 128]}/>
      <meshBasicMaterial transparent opacity={0} depthWrite={false} side={DoubleSide}/>
    </mesh>
    <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={1001} raycast={() => { }}>
      <ringGeometry args={[radius - (hovered ? 0.035 : 0.02), radius + (hovered ? 0.035 : 0.02), 128]}/>
      <meshBasicMaterial color={hovered ? '#ffd34d' : '#39ba77'} depthTest={false} depthWrite={false} side={DoubleSide}/>
    </mesh>
  </group>;
}
