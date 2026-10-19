import { SceneCapture } from './SceneCapture';
import { useMemo } from 'react';
import { Canvas, events } from '@react-three/fiber';
import { PerspectiveCamera, Vector3 } from 'three';
import { useEditorStore } from '../stores/editorStore';
import { GardenGround } from './GardenGround';
import { BrokenObject, GardenModel, SelectionOutline } from './GardenModel';
import { createPhotoCamera } from './photoCamera';
import { detectWebgl } from './webgl';
import { assetForObject } from '../domain/productModels';
import { DropPlacement } from './DropPlacement';
// SVG scaling changes the CSS size, so derive rays from the visible canvas bounds.
function photoEvents(store) {
    const farPoint = new Vector3();
    return { ...events(store), compute: (event, root) => {
            const bounds = root.gl.domElement.getBoundingClientRect();
            root.pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1);
            if (root.camera instanceof PerspectiveCamera) {
                root.raycaster.setFromCamera(root.pointer, root.camera);
                return;
            }
            // Sample near the depth centre so a legacy projective transform cannot put
            // the two samples on opposite sides of infinity. Standard orthographic
            // rays assume an unmodified projection matrix and would miss the ground.
            root.raycaster.ray.origin.set(root.pointer.x, root.pointer.y, 0).unproject(root.camera);
            farPoint.set(root.pointer.x, root.pointer.y, 0.0001).unproject(root.camera);
            root.raycaster.ray.direction.copy(farPoint).sub(root.raycaster.ray.origin).normalize();
            root.raycaster.ray.origin.addScaledVector(root.raycaster.ray.direction, -root.camera.far);
            root.raycaster.camera = root.camera;
        } };
}
export function PhotoCanvas({ document, assets, selectedAssetId, disabled, objectsVisible, retryRequest, onModelLoaded, onModelFailed, captureRef }) {
    const supported = useMemo(detectWebgl, []);
    const camera = useMemo(() => document.photo ? createPhotoCamera(document.photo, document.width, document.depth) : null, [document.photo, document.width, document.depth]);
    const assetMap = new Map(assets.map((asset) => [asset.id, asset]));
    if (!supported || !camera)
        return <div role="alert">写真上の木の表示にはWebGLが必要です。</div>;
    return <div className="photo-models" data-testid="photo-model-canvas" data-object-count={objectsVisible ? document.objects.length : 0}>
    <Canvas camera={camera} dpr={[1, 1.5]} events={photoEvents} frameloop="demand" gl={{ antialias: true, alpha: true }} onCreated={({ gl }) => gl.setClearColor(0, 0)}>
      <DropPlacement document={document} assets={assets} disabled={disabled || !objectsVisible}/>
      <SceneCapture captureRef={captureRef}/>
      <ambientLight intensity={1.7}/>
      <directionalLight position={[7, 12, 5]} intensity={2.1}/>
      <GardenGround document={document} selectedAsset={assets.find((asset) => asset.id === selectedAssetId) ?? null} disabled={disabled} invisible/>
      <group visible={objectsVisible} userData={{ captureRole: 'placements' }}>
      {document.objects.map((object) => {
            const asset = assetForObject(object, assetMap);
            if (!asset)
                return <BrokenObject key={object.id} object={object}/>;
            const retry = retryRequest?.objectId === object.id ? retryRequest.sequence : 0;
            return <PhotoObject key={object.id + ':' + retry} object={object} asset={asset} disabled={disabled} objectsVisible={objectsVisible} onModelLoaded={onModelLoaded} onModelFailed={onModelFailed}/>;
        })}
      </group>
    </Canvas>
  </div>;
}
function PhotoObject({ object, asset, disabled, objectsVisible, onModelLoaded, onModelFailed }) {
    const selected = useEditorStore((state) => state.selectedObjectId === object.id);
    function selectObject(event) {
        if (!objectsVisible) return;
        event.stopPropagation();
        if (!disabled) useEditorStore.getState().selectObject(object.id);
    }
    function stopPointer(event) {
        if (objectsVisible) event.stopPropagation();
    }
    return <group position={[object.position.x, 0, object.position.z]} rotation={[0, object.rotation.y, 0]} scale={[object.scale.x, object.scale.y, object.scale.z]} onPointerDown={selectObject} onPointerUp={stopPointer}>
    <GardenModel object={object} asset={asset} onModelLoaded={onModelLoaded} onModelFailed={onModelFailed}/>
    {selected && <SelectionOutline asset={asset}/>}
  </group>;
}
