import { photoGroundPoint, edgeLength } from "./polygonEdges";

export function groundSummary(document) {
  if (!document.photo)
    return {
      area: document.width * document.depth,
      perimeter: 2 * (document.width + document.depth),
      label: "入力寸法に基づく土台",
    };
  const photo = document.photo;
  if (photo.boundary.length < 3)
    return { area: null, perimeter: null, label: "輪郭を確定してください" };
  const points = photo.boundary.map((point) =>
    photoGroundPoint(photo, document.width, document.depth, point),
  );
  let sum = 0;
  let perimeter = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const length = edgeLength(document, i);
    if (!a || !b || length === null)
      return {
        area: null,
        perimeter: null,
        label: "計測できません。カメラ設定を確認してください",
      };
    sum += a.x * b.z - b.x * a.z;
    perimeter += length;
  }
  let label = "カメラ未設定・土台寸法からの概算";
  if (photo.calibration) label = "写真の基準実寸とカメラ設定に基づく推定";
  if (photo.calibration?.method === 'edges') label = "写真上の辺の実寸から求めたパースに基づく推定";
  return { area: Math.abs(sum) / 2, perimeter, label };
}
