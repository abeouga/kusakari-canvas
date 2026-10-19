import { SceneCapture } from './SceneCapture';
import { useMemo } from 'react';
import { Canvas, events } from '@react-three/fiber';
import { canvasPointer, setPhotoRay } from './pointerRay';
import { PlacedObject } from './PlacedObject';
import { PhotoPointerBridge } from './PhotoPointerBridge';
import { GardenGround } from './GardenGround';
import { BrokenObject } from './GardenModel';
import { createPhotoCamera } from './photoCamera';
import { detectWebgl } from './webgl';
import { assetForObject } from '../domain/productModels';
import { DropPlacement } from './DropPlacement';
// SVG scaling changes the CSS size, so derive rays from the visible canvas bounds.
function photoEvents(store) {
    return { ...events(store), compute: (event, root) => {
        root.pointer.copy(canvasPointer(event, root.gl.domElement));
        setPhotoRay(root.raycaster, root.pointer, root.camera);
    } };
}
export function PhotoCanvas({ document, assets, selectedAssetId, disabled, objectsVisible, retryRequest, onModelLoaded, onModelFailed, captureRef }) {
    const supported = useMemo(detectWebgl, []);
    // Saving replaces the document snapshot. Keep the camera (and an active
    // control) when only object positions or revision changed.
    const cameraKey = JSON.stringify([document.photo?.calibration, document.photo?.corners,
        document.photo?.projectionSize, document.photo?.imageWidth, document.photo?.imageHeight, document.width, document.depth]);
    const camera = useMemo(() => document.photo ? createPhotoCamera(document.photo, document.width, document.depth) : null, [cameraKey]);
    const assetMap = new Map(assets.map((asset) => [asset.id, asset]));
    if (!supported || !camera)
        return <div role="alert">写真上の木の表示にはWebGLが必要です。</div>;
    return <div className="photo-models" data-testid="photo-model-canvas" data-object-count={objectsVisible ? document.objects.length : 0}>
    <Canvas camera={camera} dpr={[1, 1.5]} events={photoEvents} frameloop="demand" gl={{ antialias: true, alpha: true }} onCreated={({ gl }) => gl.setClearColor(0, 0)}>
      <PhotoPointerBridge disabled={disabled || !objectsVisible}/>
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
            return <PlacedObject photoMode key={object.id + ':' + retry} object={object} asset={asset} disabled={disabled || !objectsVisible} onModelLoaded={onModelLoaded} onModelFailed={onModelFailed}/>;
        })}
      </group>
    </Canvas>
  </div>;
}
