import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';

// Opt-in, read-only development measurements. No polling or extra render loop.
export function RenderDiagnostics() {
  const { gl } = useThree();
  useEffect(() => {
    if (!import.meta.env.DEV || !new URLSearchParams(location.search).has('renderReview')) return;
    const snapshot = () => ({ frame: gl.info.render.frame, calls: gl.info.render.calls,
      triangles: gl.info.render.triangles, geometries: gl.info.memory.geometries,
      textures: gl.info.memory.textures, pixelRatio: gl.getPixelRatio() });
    window.plantRenderSnapshot = snapshot;
    return () => { if (window.plantRenderSnapshot === snapshot) delete window.plantRenderSnapshot; };
  }, [gl]);
  return null;
}
