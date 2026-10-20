import { MeshBasicMaterial, NoBlending, Color, Vector3 } from 'three';

const MAX_LAYER_CHARACTERS = 128 * 1024 * 1024;

export function findPlacements(scene) {
  const placements = [];
  scene.traverse((node) => {
    if (node.userData.capturePlacement) {
      placements.push({ node, ...node.userData.capturePlacement });
    }
  });
  return placements;
}

function isPlant(placement) {
  return placement.assetId === 'plant_modular' || placement.category === 'tree' || placement.category === 'shrub';
}

function maskMaterial(source) {
  const material = new MeshBasicMaterial({
    color: 0xffffff,
    map: source.map,
    alphaMap: source.alphaMap,
    alphaTest: source.alphaTest,
    opacity: source.opacity,
    transparent: source.transparent,
    side: source.side,
    depthTest: source.depthTest,
    depthWrite: source.depthWrite,
    colorWrite: source.colorWrite,
    polygonOffset: source.polygonOffset,
    polygonOffsetFactor: source.polygonOffsetFactor,
    polygonOffsetUnits: source.polygonOffsetUnits,
    alphaToCoverage: source.alphaToCoverage,
    vertexColors: source.vertexColors,
    visible: source.visible,
    toneMapped: false,
    fog: false,
  });
  if (!source.transparent) material.blending = NoBlending;
  const signal = { value: new Vector3() };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.captureSignal = signal;
    shader.fragmentShader = 'uniform vec3 captureSignal;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      '#include <color_fragment>\ndiffuseColor.rgb = captureSignal;',
    );
  };
  return { material, signal };
}

function restoreMaterials(meshes) {
  for (const mesh of meshes) {
    mesh.node.material = mesh.original;
    for (const mask of mesh.masks) mask.material.dispose();
  }
}

function prepareMasks(placements) {
  const meshes = [];
  try {
    for (const placement of placements) {
      placement.node.traverse((node) => {
        if (!node.isMesh) return;
        const sources = Array.isArray(node.material) ? node.material : [node.material];
        const masks = sources.map((source) => maskMaterial(source));
        meshes.push({ node, placement, original: node.material, masks });
        node.material = Array.isArray(node.material) ? masks.map((mask) => mask.material) : masks[0].material;
      });
    }
  } catch (error) {
    restoreMaterials(meshes);
    throw error;
  }
  return meshes;
}

/** Processing data only: visible plants in red, other placements in green. */
export function captureCoverage(renderer, scene, camera, placements, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const background = scene.background;
  const clearColor = renderer.getClearColor(new Color());
  const clearAlpha = renderer.getClearAlpha();
  const visibility = placements.map((placement) => placement.node.visible);
  let meshes = [];
  try {
    const output = canvas.getContext('2d');
    if (!output) throw new Error('編集領域の画像を作成できません。');
    meshes = prepareMasks(placements);
    for (const mesh of meshes) {
      for (const mask of mesh.masks) {
        if (isPlant(mesh.placement)) mask.signal.value.set(1, 0, 0);
        else mask.signal.value.set(0, 1, 0);
      }
    }
    for (const placement of placements) placement.node.visible = true;
    scene.background = null;
    renderer.setClearColor(0, 1);
    renderer.render(scene, camera);
    if (renderer.getContext().isContextLost()) {
      throw new Error('編集領域の撮影中に3D表示への接続が失われました。');
    }
    output.fillStyle = '#000000';
    output.fillRect(0, 0, width, height);
    output.drawImage(renderer.domElement, 0, 0);
    const dataUrl = canvas.toDataURL('image/png');
    if (!dataUrl.startsWith('data:image/png;')) throw new Error('編集領域のPNG画像を作成できません。');
    if (dataUrl.length > MAX_LAYER_CHARACTERS) {
      throw new Error('編集領域の画像容量が上限を超えます。写真の寸法を小さくしてください。');
    }
    return dataUrl;
  } finally {
    restoreMaterials(meshes);
    scene.background = background;
    renderer.setClearColor(clearColor, clearAlpha);
    for (const [index, placement] of placements.entries()) placement.node.visible = visibility[index];
    canvas.width = 0;
    canvas.height = 0;
  }
}
