import { calibratedBoundaryError, groundPoint, projectWorld } from './calibratedProjection';
import { isValidGardenSize } from './limits';
import { containsAnchor } from './placementBounds';
import { homography, unitCorners } from './photoProjection';
import { edgeLength } from './polygonEdges';

// 写真上の輪郭と各辺の実寸だけから、水平な地面を写すカメラを求めます。
// 画像中心を主点、正方画素、レンズ歪みなしと仮定し、未知数は画角・俯角・傾き・高さの4つです。
// 高さは辺長の比から直接求まるため、反復計算は画角・俯角・傾きの3つだけです。
export const EDGE_LENGTH_TOLERANCE = 0.01;
const DEGREE = Math.PI / 180;
const LIMITS = [[15 * DEGREE, 110 * DEGREE], [-10 * DEGREE, 89.5 * DEGREE], [-45 * DEGREE, 45 * DEGREE]];

function rotateY(vector, yaw) {
  const [x, y, z] = vector;
  return [x * Math.cos(yaw) + z * Math.sin(yaw), y, -x * Math.sin(yaw) + z * Math.cos(yaw)];
}

// OpenCVのカメラ軸（右・下・前）を世界座標で返します。yaw=0では手前（+Z）から奥（-Z）を向きます。
function cameraAxes([, pitch, roll], yaw) {
  const s = Math.sin(pitch), c = Math.cos(pitch);
  const right = [1, 0, 0], down = [0, -c, s], forward = [0, -s, -c];
  const rolledRight = right.map((v, i) => v * Math.cos(roll) + down[i] * Math.sin(roll));
  const rolledDown = right.map((v, i) => -v * Math.sin(roll) + down[i] * Math.cos(roll));
  return [rolledRight, rolledDown, forward].map((axis) => rotateY(axis, yaw));
}

function focalLength(photo, fov) {
  return photo.imageHeight / (2 * Math.tan(fov / 2));
}

function groundPoints(photo, params, yaw, height) {
  const [right, down, forward] = cameraAxes(params, yaw), f = focalLength(photo, params[0]);
  const points = [];
  for (const point of photo.boundary) {
    const u = (point.x - 0.5) * photo.imageWidth / f, v = (point.y - 0.5) * photo.imageHeight / f;
    const direction = [0, 1, 2].map((i) => u * right[i] + v * down[i] + forward[i]);
    if (direction[1] >= -1e-8) return null;
    const distance = height / -direction[1];
    points.push({ x: direction[0] * distance, z: direction[2] * distance });
  }
  return points;
}

function polygonLengths(points) {
  return points.map((a, i) => {
    const b = points[(i + 1) % points.length];
    return Math.hypot(b.x - a.x, b.z - a.z);
  });
}

// 高さ1mでの辺長と指定辺長の対数比から、最適な高さとその残差を求めます。
function evaluate(photo, params, targets) {
  const points = groundPoints(photo, params, 0, 1);
  if (!points) return null;
  const logs = polygonLengths(points).map((length, i) => Math.log(targets[i]) - Math.log(length));
  if (logs.some((value) => !Number.isFinite(value))) return null;
  const logHeight = logs.reduce((sum, value) => sum + value, 0) / logs.length;
  return { height: Math.exp(logHeight), residuals: logs.map((value) => logHeight - value) };
}

function clamp(params) {
  return params.map((value, i) => Math.min(LIMITS[i][1], Math.max(LIMITS[i][0], value)));
}

function sumOfSquares(values) {
  return values.reduce((sum, value) => sum + value * value, 0);
}

function solve3(a, b) {
  const rows = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let row = col + 1; row < 3; row++) if (Math.abs(rows[row][col]) > Math.abs(rows[pivot][col])) pivot = row;
    if (Math.abs(rows[pivot][col]) < 1e-18) return null;
    [rows[pivot], rows[col]] = [rows[col], rows[pivot]];
    for (let row = 0; row < 3; row++) {
      if (row === col) continue;
      const factor = rows[row][col] / rows[col][col];
      for (let k = col; k < 4; k++) rows[row][k] -= factor * rows[col][k];
    }
  }
  return rows.map((row, i) => row[3] / row[i]);
}

// 3変数のレーベンバーグ・マーカート法。開始値に近い解を選ぶため、現在のカメラから始めます。
function refine(photo, targets, start) {
  let params = clamp(start), result = evaluate(photo, params, targets);
  if (!result) return null;
  let damping = 1e-3;
  for (let iteration = 0; iteration < 100 && sumOfSquares(result.residuals) > 1e-24; iteration++) {
    const jacobian = [0, 1, 2].map((k) => {
      const step = 1e-7, shifted = [...params];
      shifted[k] += params[k] + step > LIMITS[k][1] ? -step : step;
      const next = evaluate(photo, shifted, targets);
      return next ? next.residuals.map((value, i) => (value - result.residuals[i]) / (shifted[k] - params[k])) : null;
    });
    if (jacobian.some((column) => !column)) return null;
    const normal = jacobian.map((a) => jacobian.map((b) => a.reduce((sum, value, i) => sum + value * b[i], 0)));
    const gradient = jacobian.map((column) => column.reduce((sum, value, i) => sum + value * result.residuals[i], 0));
    const step = solve3(normal.map((row, i) => row.map((value, j) => value + (i === j ? damping * (value + 1e-12) : 0))), gradient.map((value) => -value));
    const candidate = step && clamp(params.map((value, i) => value + step[i]));
    const next = candidate && evaluate(photo, candidate, targets);
    if (next && sumOfSquares(next.residuals) < sumOfSquares(result.residuals)) {
      params = candidate;
      result = next;
      damping = Math.max(damping / 10, 1e-12);
    } else if ((damping *= 10) > 1e12) break;
  }
  return { params, ...result };
}

function acceptable(fit) {
  return fit && fit.residuals.every((value) => Math.abs(Math.expm1(value)) <= EDGE_LENGTH_TOLERANCE);
}

// 現在のカメラから開始し、収束しない場合だけ粗い格子から開始値を選び直します。
// 許容誤差内に収まる解がなければ、入力値に最も近い（残差最小の）カメラを強制的に採用します。
function fitCamera(photo, targets, previous) {
  const starts = previous ? [previous] : [];
  const grid = [];
  for (let fov = 20; fov <= 100; fov += 10) {
    for (let pitch = 5; pitch <= 85; pitch += 5) {
      const params = [fov * DEGREE, pitch * DEGREE, 0], result = evaluate(photo, params, targets);
      if (result) grid.push({ params, cost: sumOfSquares(result.residuals) });
    }
  }
  starts.push(...grid.sort((a, b) => a.cost - b.cost).slice(0, 5).map((item) => item.params));
  let best = null;
  for (const start of starts) {
    const fit = refine(photo, targets, start);
    if (acceptable(fit)) return fit;
    if (fit && (!best || sumOfSquares(fit.residuals) < sumOfSquares(best.residuals))) best = fit;
  }
  return best;
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

// 保存済みカメラから画角・俯角・傾き・方位を取り出します。
function cameraParams(photo) {
  const c = photo.calibration;
  if (!c) return null;
  const right = c.rotation.slice(0, 3), forward = c.rotation.slice(6, 9);
  const pitch = Math.asin(Math.max(-1, Math.min(1, -forward[1])));
  const yaw = Math.atan2(-forward[0], -forward[2]);
  const [baseRight, baseDown] = cameraAxes([0, pitch, 0], yaw);
  const roll = Math.atan2(dot(right, baseDown), dot(right, baseRight));
  return { params: [2 * Math.atan(photo.imageHeight / (2 * c.focalLengthPx)), pitch, roll], yaw };
}

function imagePoint(document, position) {
  const photo = document.photo;
  if (photo.calibration) return projectWorld(photo, { x: position.x, y: 0, z: position.z });
  const project = homography(unitCorners, photo.corners);
  const frame = photo.projectionSize ?? { width: document.width, depth: document.depth };
  return project ? project({ x: position.x / frame.width + 0.5, y: 0.5 - position.z / frame.depth }) : null;
}

export function isEdgeCalibration(photo) {
  return photo?.calibration?.method === 'edges';
}

// 選択した辺の実寸だけを記録します。全辺がそろったら、写真上の輪郭と全辺の実寸からカメラを求めます。
// どの場合もほかの辺の入力値と写真上の輪郭は変更しません。
export function applyEdgeLength(document, edgeIndex, requestedLength) {
  const photo = document.photo;
  const currentLength = edgeLength(document, edgeIndex);
  if (!Number.isFinite(currentLength) || currentLength <= 0.000001) {
    return { error: 'この辺を計測できません。写真のカメラ設定を確認してください。' };
  }
  if (!Number.isFinite(requestedLength) || requestedLength <= 0) {
    return { error: '辺の長さは0より大きい数値で入力してください。' };
  }
  if (requestedLength < 0.01 || requestedLength > 100) {
    return { error: '辺の長さは0.01〜100mで入力してください。' };
  }
  const entries = photo.edgeLengths?.length === photo.boundary.length ? [...photo.edgeLengths] : photo.boundary.map(() => null);
  if (entries[edgeIndex] !== null && Math.abs(requestedLength - entries[edgeIndex]) < 1e-9) return { document };
  entries[edgeIndex] = requestedLength;
  if (entries.some((length) => length === null)) {
    return { document: { ...document, photo: { ...photo, edgeLengths: entries } } };
  }
  const previous = cameraParams(photo);
  const fit = fitCamera(photo, entries, previous?.params);
  if (!fit) {
    return { error: '写真上の輪郭からパースを求められません。輪郭を確認してください。' };
  }
  const yaw = previous?.yaw ?? 0;
  const points = groundPoints(photo, fit.params, yaw, fit.height);
  const xs = points.map((p) => p.x), zs = points.map((p) => p.z);
  const width = Math.max(...xs) - Math.min(...xs), depth = Math.max(...zs) - Math.min(...zs);
  if (!isValidGardenSize(width, depth)) {
    return { error: '変更後の庭の幅・奥行きが1〜50mに収まる長さを指定してください。' };
  }
  // 輪郭の外接矩形の中心を庭の原点にします。
  const center = [-(Math.max(...xs) + Math.min(...xs)) / 2, fit.height, -(Math.max(...zs) + Math.min(...zs)) / 2];
  const axes = cameraAxes(fit.params, yaw);
  const calibration = {
    version: 1, method: 'edges', focalLengthPx: focalLength(photo, fit.params[0]), focalSource: 'estimated',
    rotation: axes.flat(), translation: axes.map((axis) => -dot(axis, center)), reprojectionErrorPx: 0,
  };
  const nextPhoto = { ...photo, edgeLengths: entries, calibration, projectionSize: null };
  // 配置物は写真上の接地位置を保ち、新しいカメラで地面座標を求め直します。
  const objects = [];
  for (const object of document.objects) {
    const anchor = imagePoint(document, object.position);
    const ground = anchor && groundPoint(nextPhoto, anchor);
    if (!ground) return { error: '配置物の位置を新しいパースへ変換できません。' };
    objects.push({ ...object, position: { x: ground.x, y: 0, z: ground.z } });
  }
  const next = { ...document, width, depth, photo: nextPhoto, objects };
  const error = calibratedBoundaryError(nextPhoto, width, depth);
  if (error) return { error };
  if (objects.some((object) => !containsAnchor(next, object.position))) {
    return { error: '配置物が庭の外に出るため変更できません。' };
  }
  return { document: next };
}

// 輪郭を変更した場合の辺の入力値。辺から求めたカメラは保ち、新しい輪郭の辺長を記録し直します。
// カメラを求める前の入力値は、辺の数が変わった場合だけ破棄します。
export function withEdgeLengthsForBoundary(photo) {
  if (!photo?.edgeLengths) return photo;
  if (isEdgeCalibration(photo)) {
    const points = photo.boundary.map((point) => groundPoint(photo, point));
    return points.length >= 3 && points.every(Boolean) ? { ...photo, edgeLengths: polygonLengths(points) } : photo;
  }
  if (photo.edgeLengths.length === photo.boundary.length) return photo;
  return { ...photo, edgeLengths: undefined };
}
