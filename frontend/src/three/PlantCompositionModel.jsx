import { useEffect, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import { Color, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import { canvasUrl } from '../domain/urls';
const supportedParts = new Set(['stem', 'leaf-oval', 'leaf-narrow', 'leaf-needle', 'flower-five', 'flower-eight']);
const partsV2 = new Set(['stem-wood', 'stem-herb', 'stem-cane', 'stem-palm', 'stem-vine', 'stem-arching',
  'leaf-oval', 'leaf-narrow', 'leaf-needle', 'leaf-round', 'leaf-heart', 'leaf-palmate', 'leaf-split',
  'leaf-compound', 'leaf-succulent', 'leaf-grass', 'leaf-frond', 'flower-five', 'flower-eight',
  'flower-spike', 'flower-cluster', 'flower-daisy', 'flower-bell', 'flower-plume']);
const partsV3 = new Set([...partsV2, 'leaf-scale', 'flower-four', 'leaf-iberis', 'flower-iberis']);
const partsV4 = new Set([...partsV3, 'stem-natural', 'stem-petiole', 'leaf-maple', 'leaf-maple-curl',
  'leaf-monstera', 'leaf-monstera-young', 'leaf-hakone', 'leaf-hakone-curl', 'leaf-goldcrest',
  'leaf-iberis-v4', 'flower-iberis-v4']);
function partUrl(id, version) {
  const supported = version === 1 ? supportedParts : version === 2 ? partsV2
    : version === 3 ? partsV3 : version === 4 ? partsV4 : null;
  if (!supported?.has(id)) throw new Error('Unknown model part');
  return canvasUrl(`/models/plant-parts/v${version}/${id}.glb`);
}

export function clearPlantCompositionCache(composition) {
  for (const id of new Set(composition.parts.map((part) => part.partId))) {
    useGLTF.clear(partUrl(id, composition.catalogVersion));
  }
}

// GLB geometries are shared. Instances only apply the transforms saved with the product.
export function PlantCompositionModel({ composition, objectId, onLoaded }) {
  const ids = [...new Set(composition.parts.map((part) => part.partId))];
  const urls = ids.map((id) => partUrl(id, composition.catalogVersion));
  const loaded = useGLTF(urls);
  const meshes = useMemo(() => {
    const result = [];
    for (const [index, id] of ids.entries()) {
      const parts = composition.parts.filter((part) => part.partId === id);
      const perInstanceColor = composition.version >= 4;
      const colors = perInstanceColor ? [null] : [...new Set(parts.map((part) => part.color))];
      const scene = loaded[index].scene;
      scene.updateMatrixWorld(true);
      for (const color of colors) {
        const placements = perInstanceColor ? parts : parts.filter((part) => part.color === color);
        scene.traverse((source) => {
          if (!source.isMesh) return;
          const materials = Array.isArray(source.material) ? source.material : [source.material];
          const clones = materials.map((material) => {
            const clone = material.clone();
            if (color && source.name.startsWith('tint-')) clone.color.set(color);
            if (perInstanceColor && source.name.startsWith('tint-')) clone.color.set('#ffffff');
            return clone;
          });
          const mesh = new InstancedMesh(source.geometry, Array.isArray(source.material) ? clones : clones[0], placements.length);
          mesh.name = `${id}:${source.name}`;
          for (const [placementIndex, part] of placements.entries()) {
            const matrix = new Matrix4().compose(new Vector3(...part.position),
              new Quaternion(...part.quaternion), new Vector3(...part.scale));
            matrix.multiply(source.matrixWorld);
            mesh.setMatrixAt(placementIndex, matrix);
            if (perInstanceColor && source.name.startsWith('tint-')) mesh.setColorAt(placementIndex, new Color(part.color || '#ffffff'));
          }
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
          mesh.computeBoundingSphere();
          result.push(mesh);
        });
      }
    }
    return result;
  }, [composition, loaded]);
  useEffect(() => {
    onLoaded?.(objectId);
    return () => meshes.forEach((mesh) => {
      mesh.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((material) => material.dispose());
    });
  }, [meshes, objectId, onLoaded]);
  return <group scale={composition.fitScale ?? [1, 1, 1]}>{meshes.map((mesh, index) => <primitive key={index} object={mesh}/>)}</group>;
}
