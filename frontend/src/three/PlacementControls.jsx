import { useLayoutEffect, useRef } from 'react';
import { TransformControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { OrthographicCamera } from 'three';
import { canvasPointer, setPhotoRay } from './pointerRay';

// R3F model events and the control's native DOM listeners share one hit decision.
// Run it even on pointerdown without a preceding hover (touch and quick clicks).
export function handleOwnsPointer(scene, event) {
    const control = scene.getObjectByProperty('isTransformControls', true);
    if (!control?.enabled || !control.object) return false;
    control.updateMatrixWorld(true);
    control.pointerHover(control.getPointer(event.nativeEvent));
    return control.axis !== null;
}

export function PlacementControls({ photoMode, ...props }) {
    const ref = useRef(null);
    const canvas = useThree((state) => state.gl.domElement);
    const camera = useThree((state) => state.camera);
    useLayoutEffect(() => {
        const control = ref.current;
        if (!control) return;
        control.connect(canvas);
        const hover = control.pointerHover;
        control.pointerHover = (pointer) => {
            // With demand rendering, a snapshot/resize may precede the next frame.
            // Pick against current transforms, including when pressing empty space.
            control.updateMatrixWorld(true);
            hover(pointer);
        };
        if (photoMode) {
            control.getPointer = (event) => ({ ...canvasPointer(event, canvas), button: event.button });
            control.raycaster.setFromCamera = (pointer, camera) => setPhotoRay(control.raycaster, pointer, camera);
        }
        // Drei attaches the control, but native document listeners also need
        // disposal when selection changes or an interrupted drag remounts it.
        return () => { control.pointerHover = hover; control.dispose(); };
    }, [canvas, camera, photoMode]);
    // R3F's event connection becomes available after mount. Do not let that
    // replace the control behind this adapter with an unconfigured instance.
    return <TransformControls ref={ref} {...props} domElement={canvas} size={photoMode && camera instanceof OrthographicCamera ? 4 : props.size}/>;
}
