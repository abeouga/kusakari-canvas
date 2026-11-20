import type { ImagePoint, PhotoCalibration } from '../frontend/src/types/garden.js';

// 基準長方形のカメラ（method: 'rectangle'）を持つ庭を用意する。
// この形のカメラは、以前のカメラ設定画面で保存された庭にだけ残っていて、今の画面からは作れない。
// 保存（PUT）のときにサーバーが基準点と実寸からカメラを計算し直すので、姿勢は仮の値を入れる。
// 焦点距離を渡したときだけ、その値を手動で指定した画角として使う。
export function rectangleCalibration(points: ImagePoint[], referenceWidth: number, referenceDepth: number,
  focalLengthPx?: number): PhotoCalibration {
  return {
    version: 1, points, referenceWidth, referenceDepth,
    focalLengthPx: focalLengthPx ?? 1, focalSource: focalLengthPx === undefined ? 'estimated' : 'manual',
    rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1], translation: [0, 0, 0], reprojectionErrorPx: 0,
  };
}
