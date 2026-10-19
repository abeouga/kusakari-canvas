// The API accepts PNG <= 330,000 bytes, data URLs <= 450,000 characters,
// and JSON <= 460,000 bytes. 400,000 ASCII characters leave room for all three.
const MAX_DATA_URL_LENGTH = 400000;

/** @param {string} source */
export async function thumbnailImage(source) {
  const image = new Image();
  image.src = source;
  await image.decode();
  const scale = Math.min(640 / image.width, 400 / image.height, 1);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('サムネイルを作成できませんでした。');
  try {
    while (true) {
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/png');
      if (!dataUrl.startsWith('data:image/png;base64,')) {
        throw new Error('PNGサムネイルを作成できませんでした。');
      }
      if (dataUrl.length <= MAX_DATA_URL_LENGTH) return dataUrl;
      if (canvas.width === 1 && canvas.height === 1) {
        throw new Error('サムネイルの容量を縮小できませんでした。');
      }
      canvas.width = Math.max(1, Math.floor(canvas.width * 0.8));
      canvas.height = Math.max(1, Math.floor(canvas.height * 0.8));
    }
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
