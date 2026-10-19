import { Component, Suspense, useEffect, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import { BoxGeometry, EdgesGeometry } from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { PlantCompositionModel } from './PlantCompositionModel';
import { canvasAssetUrl } from '../domain/urls';
export function GardenModel({ object, asset, onModelLoaded, onModelFailed }) {
    return <group userData={{ capturePlacement: { placementId: object.id, assetId: asset.id, category: asset.category } }}>
    <AssetLoadBoundary fallback={<BrokenPlaceholder dimensions={asset.baseDimensions}/>} onError={() => onModelFailed(object.id)}>
    <Suspense fallback={<LoadingPlaceholder dimensions={asset.baseDimensions}/>}>
      {object.modelComposition ? <PlantCompositionModel composition={object.modelComposition} objectId={object.id} onLoaded={onModelLoaded}/> : <LoadedAsset asset={asset} objectId={object.id} onLoaded={onModelLoaded}/>}
    </Suspense>
  </AssetLoadBoundary>
  </group>;
}
function LoadedAsset({ asset, objectId, onLoaded }) {
    const { scene } = useGLTF(canvasAssetUrl(asset.modelUrl));
    const clone = useMemo(() => cloneSkeleton(scene), [scene]);
    useEffect(() => onLoaded(objectId), [objectId, onLoaded]);
    return <primitive object={clone}/>;
}
export function SelectionOutline({ asset }) {
    const dimensions = asset.baseDimensions;
    const geometry = useMemo(() => {
        const box = new BoxGeometry(dimensions.width, dimensions.height, dimensions.depth);
        const edges = new EdgesGeometry(box);
        box.dispose();
        return edges;
    }, [dimensions.depth, dimensions.height, dimensions.width]);
    useEffect(() => () => geometry.dispose(), [geometry]);
    return (<lineSegments geometry={geometry} position={[0, dimensions.height / 2, 0]} userData={{ captureRole: 'editor' }}>
      <lineBasicMaterial color="#bf7831" depthTest={false}/>
    </lineSegments>);
}
function LoadingPlaceholder({ dimensions }) {
    return (<mesh position={[0, dimensions.height / 2, 0]} userData={{ captureBlocker: 'loading' }}>
      <boxGeometry args={[dimensions.width * 0.7, dimensions.height * 0.7, dimensions.depth * 0.7]}/>
      <meshStandardMaterial color="#d6ba83" wireframe/>
    </mesh>);
}
function BrokenPlaceholder({ dimensions }) {
    return (<mesh position={[0, dimensions.height / 2, 0]} userData={{ captureBlocker: 'failed' }}>
      <boxGeometry args={[dimensions.width * 0.7, dimensions.height * 0.7, dimensions.depth * 0.7]}/>
      <meshStandardMaterial color="#bd554a" wireframe/>
    </mesh>);
}
export function BrokenObject({ object }) {
    return (<group position={[object.position.x, 0, object.position.z]} userData={{ captureBlocker: 'failed' }}>
      <mesh position={[0, 0.5, 0]}>
        <boxGeometry args={[0.8, 1, 0.8]}/>
        <meshStandardMaterial color="#bd554a" wireframe/>
      </mesh>
    </group>);
}
class AssetLoadBoundary extends Component {
    state = { failed: false };
    static getDerivedStateFromError() {
        return { failed: true };
    }
    componentDidCatch() {
        this.props.onError();
    }
    render() {
        if (this.state.failed)
            return this.props.fallback;
        return this.props.children;
    }
}
