import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { PerspectiveCamera, Plane, Vector2, Vector3 } from 'three';
import { useEditorStore } from '../stores/editorStore';
import { productDragType } from '../domain/productModels';
import { containsAnchor } from '../domain/placementBounds';

export function DropPlacement({ document, assets, disabled }) {
  const { gl, camera, raycaster } = useThree();
  useEffect(() => {
    const element = gl.domElement;
    function dragOver(event) {
      if (!event.dataTransfer.types.includes(productDragType)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
    }
    function drop(event) {
      if (!event.dataTransfer.types.includes(productDragType)) return;
      event.preventDefault();
      const state = useEditorStore.getState();
      if (disabled || state.isCalibrating || state.isTransformDragging || state.photoBoundaryDraft !== null) return;
      const asset = assets.find((item) => item.id === event.dataTransfer.getData(productDragType));
      if (!asset) return;
      const bounds = element.getBoundingClientRect();
      const pointer = new Vector2((event.clientX - bounds.left) / bounds.width * 2 - 1,
        -(event.clientY - bounds.top) / bounds.height * 2 + 1);
      if (camera instanceof PerspectiveCamera) raycaster.setFromCamera(pointer, camera);
      else {
        raycaster.ray.origin.set(pointer.x, pointer.y, 0).unproject(camera);
        const far = new Vector3(pointer.x, pointer.y, 0.0001).unproject(camera);
        raycaster.ray.direction.copy(far).sub(raycaster.ray.origin).normalize();
        raycaster.ray.origin.addScaledVector(raycaster.ray.direction, -camera.far);
      }
      const point = raycaster.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), 0), new Vector3());
      if (!point || !containsAnchor(document, point)) {
        state.setEditError('庭の地面の範囲内へドロップしてください。');
        return;
      }
      state.addAssetAt(asset, point.x, point.z);
      state.selectAsset(null);
    }
    element.addEventListener('dragover', dragOver);
    element.addEventListener('drop', drop);
    return () => {
      element.removeEventListener('dragover', dragOver);
      element.removeEventListener('drop', drop);
    };
  }, [gl, camera, raycaster, document, assets, disabled]);
  return null;
}
