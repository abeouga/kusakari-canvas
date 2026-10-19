"""v4 natural surfaces and deterministic per-instance pigment; no runtime noise."""

import math

from .plant_geometry_v3 import PlantBuilder, direction


class NaturalBuilder(PlantBuilder):
    def stem(self, start, end, diameter=None, kind="wood"):
        length = math.dist(start, end)
        if length < 1e-7:
            return
        thickness = self.thickness if diameter is None else diameter
        self.add("stem-natural" if kind == "wood" else "stem-petiole", start,
                 direction(start, end), (thickness, length, thickness))

    def leaf(self, point, axis, size=None, shape=None, normal=(0, 1, 0)):
        part = super().leaf(point, axis, size, shape, normal)
        # Independent of RNG consumption by geometry. Changing color cannot change structure.
        shade = (self.p.seed * 1664525 + len(self.parts) * 1013904223) % 8
        factor = 0.82 + shade * 0.045
        rgb = [int(self.p.leafColor[i:i + 2], 16) for i in (1, 3, 5)]
        part.color = "#" + "".join(f"{max(0, min(255, round(c * factor))):02x}" for c in rgb)
        return part


def tapered_path(b, points, diameter, kind="wood"):
    for i in range(len(points) - 1):
        t = i / (len(points) - 1)
        b.stem(points[i], points[i + 1], diameter * (1 - t) ** 1.1, kind)
    return points
