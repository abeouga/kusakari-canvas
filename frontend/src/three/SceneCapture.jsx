import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { renderCapture } from './renderCapture';

export function SceneCapture({ captureRef }) {
  const { gl, scene, camera } = useThree();

  useEffect(() => {
    function capture(size, options) {
      return renderCapture(gl, scene, camera, size, options);
    }
    captureRef.current = capture;
    return () => {
      if (captureRef.current === capture) captureRef.current = null;
    };
  }, [captureRef, gl, scene, camera]);

  return null;
}
