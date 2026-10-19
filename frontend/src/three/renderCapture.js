import { Vector2, Vector4 } from 'three';
import { captureCoverage, findPlacements } from './captureCoverage';
import { captureLayout } from './captureLayout';

function validateSize(renderer, context, width, height) {
  if (context.isContextLost()) {
    throw new Error('3D表示への接続が失われました。画面を再読み込みしてください。');
  }
  if (renderer.xr.isPresenting) {
    throw new Error('VR表示を終了してから画像を作成してください。');
  }
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error('撮影する画像の寸法が不正です。');
  }
  const maxBuffer = context.getParameter(context.MAX_RENDERBUFFER_SIZE);
  const maxViewport = context.getParameter(context.MAX_VIEWPORT_DIMS);
  if (width > maxBuffer || height > maxBuffer || width > maxViewport[0] || height > maxViewport[1]) {
    throw new Error('元の画像寸法で撮影できません。より小さい写真を選択してください。');
  }
}

function findCaptureNodes(scene) {
  const visibility = [];
  let loading = false;
  let failed = false;
  // Hidden placements must also be ready before they can enter the captured image.
  scene.traverse((node) => {
    if (node.userData.captureBlocker === 'loading') loading = true;
    if (node.userData.captureBlocker === 'failed') failed = true;
    const role = node.userData.captureRole;
    if (role === 'editor' || role === 'placements') {
      visibility.push({ node, visible: node.visible, role });
    }
    if (node.userData.capturePlacement) {
      visibility.push({ node, visible: node.visible, role: 'placements' });
    }
  });
  if (failed) {
    throw new Error('読み込めないモデルがあります。モデルを再試行するか配置を削除してください。');
  }
  if (loading) {
    throw new Error('モデルを読み込み中です。読み込み完了後に再試行してください。');
  }
  return visibility;
}

/** Copy the current camera's render synchronously, then restore the editing view. */
export function renderCapture(renderer, scene, camera, size, options = {}) {
  const context = renderer.getContext();
  const bufferSize = renderer.getDrawingBufferSize(new Vector2());
  let width = bufferSize.x;
  let height = bufferSize.y;
  if (size) {
    width = size.width;
    height = size.height;
  }
  validateSize(renderer, context, width, height);
  const visibility = findCaptureNodes(scene);
  const placements = findPlacements(scene);
  const snapshot = document.createElement('canvas');
  snapshot.width = width;
  snapshot.height = height;
  const output = snapshot.getContext('2d');
  if (!output) throw new Error('画像を作成できません。');
  const processing = {};

  const previous = {
    size: renderer.getSize(new Vector2()),
    pixelRatio: renderer.getPixelRatio(),
    viewport: renderer.getViewport(new Vector4()),
    scissor: renderer.getScissor(new Vector4()),
    scissorTest: renderer.getScissorTest(),
    renderTarget: renderer.getRenderTarget(),
    cubeFace: renderer.getActiveCubeFace(),
    mipmapLevel: renderer.getActiveMipmapLevel(),
    autoClear: renderer.autoClear,
    autoClearColor: renderer.autoClearColor,
    autoClearDepth: renderer.autoClearDepth,
    autoClearStencil: renderer.autoClearStencil,
  };
  try {
    for (const item of visibility) {
      item.node.visible = item.role === 'placements';
    }
    // Keep the default framebuffer's tone mapping and output colour conversion.
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    renderer.setRenderTarget(null);
    renderer.setViewport(0, 0, width, height);
    renderer.setScissorTest(false);
    renderer.autoClear = true;
    renderer.autoClearColor = true;
    renderer.autoClearDepth = true;
    renderer.autoClearStencil = true;
    if (context.drawingBufferWidth !== width || context.drawingBufferHeight !== height) {
      throw new Error('元の画像寸法で描画できません。より小さい写真を選択してください。');
    }
    renderer.render(scene, camera);
    if (context.isContextLost()) {
      throw new Error('撮影中に3D表示への接続が失われました。画面を再読み込みしてください。');
    }
    output.drawImage(renderer.domElement, 0, 0);
    if (options.includeCoverage) {
      processing.layout = captureLayout(placements, camera, width, height);
      processing.coverageDataUrl = captureCoverage(renderer, scene, camera, placements, width, height);
    }
  } finally {
    for (const item of visibility) item.node.visible = item.visible;
    // Restore logical size at DPR 1 before reapplying the original DPR.
    renderer.setPixelRatio(1);
    renderer.setSize(previous.size.x, previous.size.y, false);
    renderer.setPixelRatio(previous.pixelRatio);
    renderer.setRenderTarget(previous.renderTarget, previous.cubeFace, previous.mipmapLevel);
    renderer.setViewport(previous.viewport);
    renderer.setScissor(previous.scissor);
    renderer.setScissorTest(previous.scissorTest);
    renderer.autoClear = previous.autoClear;
    renderer.autoClearColor = previous.autoClearColor;
    renderer.autoClearDepth = previous.autoClearDepth;
    renderer.autoClearStencil = previous.autoClearStencil;
    if (!context.isContextLost()) renderer.render(scene, camera);
  }
  return { canvas: snapshot, width, height, ...processing };
}
