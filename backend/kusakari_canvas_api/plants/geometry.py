"""Placement maths and the part list builder, in metres with +Y up. Independent of plant_legacy."""

import math
import random

import numpy as np

UP = (0.0, 1.0, 0.0)
STEM_PARTS = {"wood": "stem-natural", "herb": "stem-petiole", "palm": "stem-palm"}


def rounded(value: float, digits: int) -> float:
    # JSON.stringify normalizes -0 to 0. Canonicalize so EC and Canvas store identical JSON.
    result = round(float(value), digits)
    return 0.0 if result == 0 else result


def normalize(v):
    size = math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
    return (v[0] / size, v[1] / size, v[2] / size)


def add(a, b, scale=1.0):
    return (a[0] + b[0] * scale, a[1] + b[1] * scale, a[2] + b[2] * scale)


def radial(angle, radius, height):
    return (math.cos(angle) * radius, height, math.sin(angle) * radius)


def quaternion(direction):
    """Rotation taking the part's +Y axis to ``direction`` (x, y, z, w)."""
    x, y, z = normalize(direction)
    q = (z, 0.0, -x, 1.0 + y)
    length = math.sqrt(sum(value * value for value in q))
    if length < 1e-8:
        return (1.0, 0.0, 0.0, 0.0)
    return tuple(value / length for value in q)


def rotate(point, q):
    x, y, z = point
    qx, qy, qz, qw = q
    tx, ty, tz = 2 * (qy * z - qz * y), 2 * (qz * x - qx * z), 2 * (qx * y - qy * x)
    return (x + qw * tx + qy * tz - qz * ty, y + qw * ty + qz * tx - qx * tz, z + qw * tz + qx * ty - qy * tx)


def frame(axis, normal):
    """Point +Y along ``axis`` and turn the part about it so its +Z faces ``normal``."""
    q = quaternion(axis)
    x, z = rotate((1, 0, 0), q), rotate((0, 0, 1), q)
    angle = math.atan2(sum(a * b for a, b in zip(normal, x)), sum(a * b for a, b in zip(normal, z)))
    s, c = math.sin(angle / 2), math.cos(angle / 2)
    a, b, d, w = q
    return (a * c - d * s, b * c + w * s, d * c + a * s, w * c - b * s)


def perpendiculars(tangent):
    t = normalize(tangent)
    helper = (1.0, 0.0, 0.0) if abs(t[1]) > 0.9 else UP
    u = normalize((t[1] * helper[2] - t[2] * helper[1], t[2] * helper[0] - t[0] * helper[2],
                   t[0] * helper[1] - t[1] * helper[0]))
    v = (t[1] * u[2] - t[2] * u[1], t[2] * u[0] - t[0] * u[2], t[0] * u[1] - t[1] * u[0])
    return u, v


def bezier(start, control, end, segments):
    points = []
    for i in range(segments + 1):
        t = i / segments
        points.append(tuple((1 - t) ** 2 * start[j] + 2 * (1 - t) * t * control[j] + t * t * end[j]
                            for j in range(3)))
    return points


def on_curve(points, t):
    segment = min(len(points) - 2, int(t * (len(points) - 1)))
    u = t * (len(points) - 1) - segment
    return tuple(points[segment][k] * (1 - u) + points[segment + 1][k] * u for k in range(3))


def tangent(points, t):
    segment = min(len(points) - 2, int(t * (len(points) - 1)))
    a, b = points[segment], points[segment + 1]
    delta = (b[0] - a[0], b[1] - a[1], b[2] - a[2])
    return normalize(delta) if any(abs(v) > 1e-12 for v in delta) else UP


def rotation_matrices(quaternions):
    """Rows are the rotated basis vectors, so ``points @ matrix`` rotates row vectors."""
    x, y, z, w = (quaternions[:, i] for i in range(4))
    m = np.empty((len(quaternions), 3, 3))
    m[:, 0] = np.stack([1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)], axis=1)
    m[:, 1] = np.stack([2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)], axis=1)
    m[:, 2] = np.stack([2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)], axis=1)
    return m


def measure(parts, catalog):
    """Axis-aligned bounds of the placed GLB hulls."""
    groups = {}
    for part in parts:
        groups.setdefault(part[0], []).append(part)
    low, high = np.full(3, math.inf), np.full(3, -math.inf)
    for part_id, items in groups.items():
        position = np.array([p[1] for p in items])
        matrices = rotation_matrices(np.array([p[2] for p in items]))
        scaled = catalog[part_id]["points"][None, :, :] * np.array([p[3] for p in items])[:, None, :]
        world = np.einsum("nki,nij->nkj", scaled, matrices) + position[:, None, :]
        low, high = np.minimum(low, world.min(axis=(0, 1))), np.maximum(high, world.max(axis=(0, 1)))
    return low, high


class Builder:
    """Collects (partId, position, quaternion, scale, color) tuples for one size of the plant.

    Every random draw happens in the same order for any height/width, so the envelope fit only scales
    one fixed structure. Part counts never depend on the size either.
    """

    def __init__(self, profile, traits, catalog, height, width):
        self.p, self.t, self.catalog = profile, traits, catalog
        self.s = traits.shape
        self.h, self.w = height, width
        self.thickness = profile.trunkThicknessCm / 100
        self.rng = random.Random(profile.seed)
        self.parts = []
        self.leaf_count = 0

    def add(self, part_id, point, axis, scale, color=None, normal=(0, 1, 0)):
        q = frame(axis, normal)
        part = (part_id, tuple(rounded(v, 8) for v in point), tuple(rounded(v, 9) for v in q),
                tuple(rounded(v, 8) for v in scale), color)
        self.parts.append(part)
        return part

    def segment(self, start, end, diameter, kind="wood"):
        length = math.dist(start, end)
        if length > 1e-7:
            self.add(STEM_PARTS[kind], start, (end[0] - start[0], end[1] - start[1], end[2] - start[2]),
                     (diameter, length, diameter))

    def path(self, points, diameter, taper, kind="wood"):
        """Consecutive segments sharing endpoints; ``taper`` 1 thins the tip to 12% of the base."""
        count = len(points) - 1
        for i in range(count):
            u = (i + 0.5) / count
            self.segment(points[i], points[i + 1], diameter * (1 - taper * 0.88 * u), kind)
        return points

    def leaf_size(self, u):
        """Base size, scaled from 1 at the shoot base to the tip ratio at the tip, with seeded variation."""
        variation = 1 + self.s.leaf_variation * self.rng.uniform(-1, 1)
        return self.t.leaf_size * (1 + (self.s.leaf_tip_ratio - 1) * u) * variation

    def leaf(self, point, axis, size, normal=(0, 1, 0), part_id=None):
        part_id = part_id or self.t.leaf_parts[self.leaf_count % len(self.t.leaf_parts)]
        self.leaf_count += 1
        # Per-instance shade from the seed and leaf order only; colour never changes the structure.
        shade = (self.p.seed * 1664525 + self.leaf_count * 1013904223) % 8
        factor = 0.82 + shade * 0.045
        rgb = [int(self.p.leafColor[i:i + 2], 16) for i in (1, 3, 5)]
        color = "#" + "".join(f"{max(0, min(255, round(c * factor))):02x}" for c in rgb)
        scale = size / self.catalog[part_id]["referenceLength"]
        part = self.add(part_id, point, axis, (scale,) * 3, color, normal)
        if point[1] < size * 1.5:
            low, _ = measure([part], self.catalog)
            if low[1] < 0.001:
                # Lift only this leaf and connect it, never the plant root.
                lifted = (part[1][0], rounded(part[1][1] + 0.001 - low[1], 8), part[1][2])
                self.parts[-1] = (part[0], lifted, *part[2:])
                self.segment(point, lifted, min(size * 0.018, 0.002), "herb")
                part = self.parts[-2]
        return part

    def flower(self, point, size=None, axis=UP):
        if not self.t.flower_part:
            return None
        reference = self.catalog[self.t.flower_part]["referenceLength"]
        scale = (size if size is not None else self.t.flower_size) / reference
        return self.add(self.t.flower_part, point, axis, (scale,) * 3, self.p.flowerColor, (0, 0, 1))
