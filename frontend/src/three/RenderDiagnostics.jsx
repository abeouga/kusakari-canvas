import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';

// Opt-in, read-only development measurements. No polling or extra render loop.
export function RenderDiagnostics() {
  const { gl } = useThree();
  const diagnostics = /** @type {Window & {plantRenderSnapshot?: () => {frame: number, calls: number, triangles: number, geometries: number, textures: number, pixelRatio: number}}} */ (window);
  useEffect(() => {
    if (!import.meta.env.DEV || !new URLSearchParams(location.search).has('renderReview')) return;
    const snapshot = () => ({ frame: gl.info.render.frame, calls: gl.info.render.calls,
      triangles: gl.info.render.triangles, geometries: gl.info.memory.geometries,
      textures: gl.info.memory.textures, pixelRatio: gl.getPixelRatio() });
    diagnostics.plantRenderSnapshot = snapshot;
    return () => { if (diagnostics.plantRenderSnapshot === snapshot) delete diagnostics.plantRenderSnapshot; };
  }, [gl, diagnostics]);
  return null;
}
