import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { Raycaster } from 'three';
import { canvasPointer, setPhotoRay } from './pointerRay';
import { handleOwnsPointer } from './PlacementControls';

// SVG measurement edges sit above the transparent WebGL canvas. Forward only
// presses that hit a placement/control; other presses still edit the SVG edge.
export function PhotoPointerBridge({ disabled }) {
    const { gl, scene, camera } = useThree();
    const blocked = useRef(disabled);
    blocked.current = disabled;
    useEffect(() => {
        const canvas = gl.domElement;
        const svg = canvas.closest('svg');
        if (!svg) return;
        const raycaster = new Raycaster();
        let forwarded = false;
        function down(event) {
            if (event.target === canvas) return;
            forwarded = false;
            if (blocked.current || event.button !== 0) return;
            const pointer = canvasPointer(event, canvas);
            let hit = handleOwnsPointer(scene, { nativeEvent: event });
            if (!hit) {
                scene.updateMatrixWorld(true);
                setPhotoRay(raycaster, pointer, camera);
                const placements = [];
                scene.traverseVisible(node => { if (node.userData.capturePlacement) placements.push(node); });
                hit = raycaster.intersectObjects(placements, true).length > 0;
            }
            if (!hit) return;
            forwarded = true;
            event.preventDefault();
            event.stopPropagation();
            canvas.dispatchEvent(new PointerEvent('pointerdown', event));
        }
        function click(event) {
            if (!forwarded) return;
            forwarded = false;
            event.preventDefault();
            event.stopPropagation();
        }
        svg.addEventListener('pointerdown', down, true);
        svg.addEventListener('click', click, true);
        return () => {
            svg.removeEventListener('pointerdown', down, true);
            svg.removeEventListener('click', click, true);
        };
    }, [gl, scene, camera]);
    return null;
}
