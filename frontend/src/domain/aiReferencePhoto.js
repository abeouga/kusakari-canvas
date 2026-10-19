const MAX_BYTES = 8_000_000;
const MAX_EDGE = 2048;
const MAX_PIXELS = 3_686_400;

export function requiredReferencePhotoMessage(product) {
  if (/\.svg(?:$|[?#])/i.test(product.imageUrl ?? '')) {
    return '登録画像は参考図です。PNG/JPEG/WebPの参考写真を追加してください。';
  }
  return '登録画像を生成に使用できません。PNG/JPEG/WebPの参考写真を追加してください。';
}

function matchesFormat(bytes, type) {
  if (type === 'image/png') {
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    return signature.every((value, index) => bytes[index] === value);
  }
  if (type === 'image/jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (type === 'image/webp') {
    const header = new TextDecoder().decode(bytes.slice(0, 12));
    return header.startsWith('RIFF') && header.slice(8) === 'WEBP';
  }
  return false;
}

export async function readAiReferencePhoto(file) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    throw new Error('参考写真はPNG/JPEG/WebPで選択してください。SVGは使用できません。');
  }
  if (file.size === 0 || file.size > MAX_BYTES) {
    throw new Error('参考写真は8,000,000バイト以下の画像を選択してください。');
  }
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (!matchesFormat(header, file.type)) throw new Error('参考写真の形式と内容が一致しません。');
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('参考写真を読み込めませんでした。'));
    reader.readAsDataURL(file);
  });
  const image = new Image();
  image.src = dataUrl;
  try {
    await image.decode();
  } catch {
    throw new Error('参考写真を画像として読み込めませんでした。');
  }
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  image.src = '';
  if (width < 1 || height < 1 || width > MAX_EDGE || height > MAX_EDGE || width * height > MAX_PIXELS) {
    throw new Error('参考写真は各辺2,048px以下、合計3,686,400画素以下にしてください。');
  }
  return { dataUrl, name: file.name, width, height };
}

export function plantReferenceRows(document, assets) {
  const rows = [];
  for (const object of document.objects) {
    const asset = assets.find((item) => item.id === object.assetId);
    if (asset?.category !== 'tree' && asset?.category !== 'shrub') continue;
    const productId = object.assetId === 'plant_modular' ? object.productId : null;
    const key = `${object.assetId}:${productId ?? ''}`;
    const row = rows.find((item) => item.key === key);
    if (row) row.quantity += 1;
    else rows.push({ key, assetId: asset.id, productId,
      name: object.productName ?? asset.name, quantity: 1 });
  }
  return rows;
}
