"""Rigid leaf placements and independent geometry measurements, in metres."""

import math
import random

import numpy as np

from .plant_assembly import quaternion, rotate, rounded
from .plant_schemas import ModelPart


def direction(a, b):
    delta = np.array(b) - np.array(a)
    return tuple(delta / np.linalg.norm(delta))


def frame(axis, normal):
    q = quaternion(axis)
    x, z = rotate((1, 0, 0), q), rotate((0, 0, 1), q)
    angle = math.atan2(sum(a * b for a, b in zip(normal, x)), sum(a * b for a, b in zip(normal, z)))
    s, c = math.sin(angle / 2), math.cos(angle / 2)
    a, b, d, w = q
    return (a * c - d * s, b * c + w * s, d * c + a * s, w * c - b * s)


def part_bounds(part, catalog):
    q = part.quaternion
    matrix = np.array([rotate((1, 0, 0), q), rotate((0, 1, 0), q), rotate((0, 0, 1), q)])
    vertices = (catalog[part.partId]["points"] * part.scale) @ matrix + part.position
    return vertices.min(axis=0), vertices.max(axis=0)


def bounds(parts, catalog):
    minimum, maximum = np.full(3, math.inf), np.full(3, -math.inf)
    for part in parts:
        lo, hi = part_bounds(part, catalog)
        minimum, maximum = np.minimum(minimum, lo), np.maximum(maximum, hi)
    return minimum, maximum


class PlantBuilder:
    def __init__(self, profile, catalog, height, width):
        self.p, self.catalog, self.h, self.w = profile, catalog, height, width
        self.rng, self.parts = random.Random(profile.seed), []
        self.leaf_size = profile.leafSizeCm / 100
        self.density = {"low": 3, "medium": 5, "high": 8}[profile.leafDensity]
        self.thickness = profile.trunkThicknessCm / 100

    def add(self, part_id, point, axis, scale, color=None, normal=(0, 1, 0)):
        q = frame(axis, normal)
        part = ModelPart(
            partId=part_id,
            position=tuple(rounded(float(v), 8) for v in point),
            quaternion=tuple(rounded(v, 9) for v in q),
            scale=tuple(rounded(float(v), 8) for v in scale),
            color=color,
        )
        self.parts.append(part)
        return part

    def stem(self, start, end, diameter=None, kind="wood"):
        length = math.dist(start, end)
        if length < 1e-7:
            return
        thickness = diameter if diameter is not None else self.thickness
        self.add(f"stem-{kind}", start, direction(start, end), (thickness, length, thickness))

    def curve(self, start, end, diameter, kind="wood", bow=0.1):
        # Shared endpoint graph keeps stems and leaves attached after envelope fitting.
        middle = ((start[0] + end[0]) * 0.5, (start[1] + end[1]) * 0.5 + bow, (start[2] + end[2]) * 0.5)
        points = []
        for i in range(5):
            t = i / 4
            points.append(
                tuple(
                    (1 - t) ** 2 * start[j] + 2 * (1 - t) * t * middle[j] + t * t * end[j] for j in range(3)
                )
            )
        for i in range(4):
            self.stem(points[i], points[i + 1], diameter * 0.92**i, kind)
        return points

    def leaf(self, point, axis, size=None, shape=None, normal=(0, 1, 0)):
        part_id = f"leaf-{shape or self.p.leafShape}"
        length = size if size is not None else self.leaf_size
        scale = length / self.catalog[part_id]["referenceLength"]
        part = self.add(part_id, point, axis, (scale,) * 3, self.p.leafColor, normal)
        low, _ = part_bounds(part, self.catalog)
        if low[1] < 0.001:
            # Move only this leaf and connect its petiole, never lift the plant root.
            part.position = (
                part.position[0],
                rounded(part.position[1] + 0.001 - low[1], 8),
                part.position[2],
            )
            self.stem(point, part.position, min(length * 0.018, 0.002), "herb")
        return part

    def flower(self, point, size=None, shape=None):
        if not self.p.flowerEnabled:
            return
        part_id = f"flower-{shape or self.p.flowerShape}"
        scale = (size if size is not None else self.p.flowerSizeCm / 100) / self.catalog[part_id][
            "referenceLength"
        ]
        self.add(part_id, point, (0, 1, 0), (scale,) * 3, self.p.flowerColor, (0, 0, 1))

    def foliage(self, start, end, count=None, path=None):
        for i in range(count or self.density):
            t = 0.18 + 0.78 * i / max(1, (count or self.density) - 1)
            point = on_curve(path, t) if path else tuple(start[j] * (1 - t) + end[j] * t for j in range(3))
            angle = i * 2.39996 + self.rng.uniform(-0.25, 0.25)
            self.leaf(
                point,
                (math.cos(angle), self.rng.uniform(0.1, 0.5), math.sin(angle)),
                self.leaf_size * self.rng.uniform(0.85, 1.05),
            )


def radial(angle, radius, height):
    return (math.cos(angle) * radius, height, math.sin(angle) * radius)


def on_curve(points, t):
    segment = min(len(points) - 2, int(t * (len(points) - 1)))
    u = t * (len(points) - 1) - segment
    return tuple(points[segment][k] * (1 - u) + points[segment + 1][k] * u for k in range(3))
