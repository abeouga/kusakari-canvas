import { Suspense, useCallback, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useQuery } from '@tanstack/react-query';
import { requestJson } from '../api/http';
import { PlantCompositionModel } from '../three/PlantCompositionModel';
import { RenderDiagnostics } from '../three/RenderDiagnostics';

export function PlantPreviewPage() {
  const query = new URLSearchParams(window.location.search);
  const encoded = query.get('profile');
  const composition = useQuery({ queryKey: ['plant-preview', encoded], retry: false,
    queryFn: () => requestJson('/api/model-assemblies/resolve', { method: 'POST', body: encoded }) });
  if (composition.isPending) return <p role="status">植物を確認しています…</p>;
  if (composition.isError) return <p role="alert">{composition.error.message || 'プレビューを表示できません。入力値とCanvasの起動を確認してください。'}</p>;
  return <PlantPreviewScene composition={composition.data}/>;
}
function PlantPreviewScene({ composition }) {
  const [loaded, setLoaded] = useState(false);
  const markLoaded = useCallback(() => setLoaded(true), []);
  const size = composition.baseDimensions;
  const camera = useMemo(() => {
    const distance = Math.max(size.width, size.height, size.depth) * 2;
    return { position: /** @type {[number, number, number]} */ ([distance * 0.55, size.height / 2 + distance * 0.65, distance * 0.75]), fov: 42 };
  }, [size]);
  return <div style={{ height: '100dvh', minHeight: 260, position: 'relative', background: '#eef1e7' }} data-testid="plant-preview-scene">
    <Canvas camera={camera} dpr={[1, 1.5]} frameloop="demand">
      <RenderDiagnostics/>
      <ambientLight intensity={1.8}/><directionalLight position={[5, 8, 4]} intensity={2.1}/>
      <OrbitControls target={[0, size.height / 2, 0]} minDistance={size.height * 0.5} maxDistance={size.height * 8}/>
      <Suspense fallback={null}><PlantCompositionModel composition={composition} onLoaded={markLoaded}/></Suspense>
    </Canvas>
    <span style={{ position: 'absolute', left: 10, bottom: 10, fontSize: 12 }}>高さ {size.height.toFixed(2)} m · ドラッグで回転</span>
    <span data-testid="preview-loaded" hidden>{loaded ? 'loaded' : 'loading'}</span>
  </div>;
}
