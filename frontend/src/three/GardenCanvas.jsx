import { SceneCapture } from './SceneCapture';
import { useEffect, useMemo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, useGLTF } from '@react-three/drei';
import { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useEditorStore } from '../stores/editorStore';
import { PlacedObject } from './PlacedObject';
import { GardenGround } from './GardenGround';
import { BrokenObject } from './GardenModel';
import { detectWebgl } from './webgl';
import { assetForObject } from '../domain/productModels';
import { DropPlacement } from './DropPlacement';
import { RenderDiagnostics } from './RenderDiagnostics';
export function GardenCanvas({ document, assets, selectedAssetId, disabled, retryRequest, onModelLoaded, onModelFailed, editorOverlay, captureRef }) {
    const webglSupported = useMemo(() => detectWebgl(), []);
    const assetMap = new Map(assets.map((asset) => [asset.id, asset]));
    if (!webglSupported) {
        return <div className="canvas-unavailable" role="alert">このブラウザーではWebGLを利用できません。WebGL対応ブラウザーで開き直してください。</div>;
    }
    return (<div className="garden-canvas" data-testid="garden-canvas">
      <Canvas camera={{ position: [13, 14, 15], fov: 42, near: 0.1, far: 300 }} dpr={[1, 1.5]} gl={{ antialias: true }} frameloop="demand">
        <RenderDiagnostics/>
        <DropPlacement document={document} assets={assets} disabled={disabled}/>
        <SceneCapture captureRef={captureRef}/>
        <color attach="background" args={['#eef1e7']}/>
        <ambientLight intensity={1.7}/>
        <directionalLight position={[7, 12, 5]} intensity={2.1}/>
        <CameraRig width={document.width} depth={document.depth}/>
        <OrbitControls makeDefault enabled={!useEditorStore((state) => state.isTransformDragging)} enableDamping dampingFactor={0.08} maxPolarAngle={Math.PI / 2 + 0.08} minDistance={2} maxDistance={100}/>
        <GardenGround document={document} selectedAsset={assets.find((asset) => asset.id === selectedAssetId) ?? null} disabled={disabled}/>
        {document.objects.map((object) => {
            const asset = assetForObject(object, assetMap);
            if (!asset)
                return <BrokenObject key={object.id} object={object}/>;
            const retry = retryRequest?.objectId === object.id ? retryRequest.sequence : 0;
            return (<PlacedObject key={`${object.id}:${retry}`} object={object} asset={asset} disabled={disabled} onModelLoaded={onModelLoaded} onModelFailed={onModelFailed}/>);
        })}
      </Canvas>
      {editorOverlay}
      <div className="canvas-corner-label" aria-hidden="true">N</div>
    </div>);
}
export function clearGardenModelCache(url) {
    useGLTF.clear(canvasAssetUrl(url));
}
function CameraRig({ width, depth }) {
    const cameraCommand = useEditorStore((state) => state.cameraCommand);
    const { camera, controls, invalidate } = useThree();
    useEffect(() => {
        const orbit = controls;
        if (!(orbit instanceof OrbitControlsImpl))
            return;
        orbit.target.set(0, 0, 0);
        if (cameraCommand.view === 'top') {
            camera.up.set(0, 0, -1);
            camera.position.set(0, Math.max(width, depth) * 1.8, 0.001);
        }
        else {
            camera.up.set(0, 1, 0);
            camera.position.set(width * 0.85 + depth * 0.35, Math.max(width, depth) * 1.15, depth * 0.95 + width * 0.25);
        }
        camera.lookAt(0, 0, 0);
        orbit.update();
        invalidate();
    }, [camera, cameraCommand.sequence, cameraCommand.view, controls, depth, width, invalidate]);
    return null;
}
import { canvasAssetUrl } from "../domain/urls";
