"""Construction boundary in ground metres; only the placement anchor is constrained."""
import math

import numpy as np

from .errors import bad_request
from .schemas import GardenDocumentRequest

EPSILON = 1e-6


def ground_outline(document: GardenDocumentRequest) -> list[tuple[float, float]]:
    photo = document.photo
    w, d = document.width / 2, document.depth / 2
    if photo is None:
        return [(-w, d), (w, d), (w, -d), (-w, -d)]
    if photo.calibration:
        c = photo.calibration
        rotation = np.array(c.rotation).reshape(3, 3)
        origin = -rotation.T @ np.array(c.translation)
        result = []
        for point in photo.boundary:
            ray = rotation.T @ np.array([(point.x - 0.5) * photo.imageWidth / c.focalLengthPx,
                                         (point.y - 0.5) * photo.imageHeight / c.focalLengthPx, 1])
            ground = origin - ray * origin[1] / ray[1]
            result.append((float(ground[0]), float(ground[2])))
        return result
    # Solve in float64 so edge inclusion agrees with JavaScript at metre precision.
    frame = photo.projectionSize
    w, d = (frame.width / 2, frame.depth / 2) if frame else (w, d)
    rows, values = [], []
    for point, (x, z) in zip(photo.corners, [(-w, d), (w, d), (w, -d), (-w, -d)], strict=True):
        u, v = point.x, point.y
        rows.extend([[u, v, 1, 0, 0, 0, -x*u, -x*v], [0, 0, 0, u, v, 1, -z*u, -z*v]])
        values.extend([x, z])
    try:
        h = np.append(np.linalg.solve(rows, values), 1).reshape(3, 3)
    except np.linalg.LinAlgError:
        bad_request('INVALID_PHOTO_BOUNDARY', '施工範囲を地面へ変換できません。')
    result = []
    for point in photo.boundary:
        mapped = h @ np.array([point.x, point.y, 1])
        if abs(mapped[2]) < 1e-8:
            bad_request('INVALID_PHOTO_BOUNDARY', '施工範囲を地面へ変換できません。')
        result.append((float(mapped[0] / mapped[2]), float(mapped[1] / mapped[2])))
    return result


def contains_anchor(outline: list[tuple[float, float]], x: float, z: float) -> bool:
    inside = False
    for i, (ax, az) in enumerate(outline):
        bx, bz = outline[(i + 1) % len(outline)]
        dx, dz = bx - ax, bz - az
        squared = dx*dx + dz*dz
        t = max(0, min(1, ((x-ax)*dx + (z-az)*dz) / squared)) if squared else 0
        if math.hypot(x-ax-t*dx, z-az-t*dz) <= EPSILON:
            return True
        if (az > z) != (bz > z) and x < dx * (z-az) / dz + ax:
            inside = not inside
    return inside
