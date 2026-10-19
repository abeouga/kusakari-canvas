// Bound the Before image and optional processing data together.
const MAX_RESULT_CHARACTERS = 128 * 1024 * 1024;

async function loadPhoto(source, width, height) {
  const image = new Image();
  image.src = source;
  try {
    await image.decode();
  } catch {
    throw new Error('庭の写真を読み込めませんでした。写真を選び直してください。');
  }
  if (image.naturalWidth !== width || image.naturalHeight !== height) {
    throw new Error('庭の写真と保存された寸法が一致しません。写真を選び直してください。');
  }
  return image;
}

function encodePng(canvas) {
  const dataUrl = canvas.toDataURL('image/png');
  if (!dataUrl.startsWith('data:image/png;')) {
    throw new Error('PNG画像を作成できませんでした。再試行してください。');
  }
  return dataUrl;
}

export async function captureImage(garden, photoMode, captureScene, options = {}) {
  if (photoMode && !garden.photo) {
    throw new Error('庭の写真を選択してから画像を作成してください。');
  }
  if (typeof captureScene !== 'function') {
    throw new Error('3D表示の読み込み完了後に実行してください。');
  }

  // Fix both the source photo and the 3D pixels before awaiting image decoding.
  let photoSource = null;
  let size;
  if (photoMode) {
    photoSource = garden.photo.dataUrl;
    size = { width: garden.photo.imageWidth, height: garden.photo.imageHeight };
  }
  const includeCoverage = photoMode && options.includeCoverage === true;
  const snapshot = captureScene(size, { includeCoverage });
  const { width, height } = snapshot;
  const output = document.createElement('canvas');
  output.width = width;
  output.height = height;
  try {
    const context = output.getContext('2d');
    if (!context) throw new Error('画像を作成できません。');
    let photo = null;
    if (photoMode) {
      photo = await loadPhoto(photoSource, width, height);
      context.drawImage(photo, 0, 0);
    }
    context.drawImage(snapshot.canvas, 0, 0);
    const dataUrl = encodePng(output);
    snapshot.canvas.width = 0;
    snapshot.canvas.height = 0;
    let resultSize = dataUrl.length;
    if (includeCoverage) {
      resultSize += snapshot.coverageDataUrl.length;
      if (resultSize > MAX_RESULT_CHARACTERS) {
        throw new Error('撮影画像の合計容量が上限を超えます。写真の寸法を小さくしてください。');
      }
    }
    const result = { dataUrl, width, height, hasPhoto: photoMode };
    if (includeCoverage) {
      result.coverageDataUrl = snapshot.coverageDataUrl;
      result.layout = snapshot.layout;
    }
    return result;
  } finally {
    snapshot.canvas.width = 0;
    snapshot.canvas.height = 0;
    output.width = 0;
    output.height = 0;
  }
}
