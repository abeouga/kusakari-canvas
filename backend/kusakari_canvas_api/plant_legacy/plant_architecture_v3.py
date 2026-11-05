"""Generic growth forms. Botanical references are separate from generic combinations."""

import math

from .plant_geometry_v3 import on_curve, radial


def generic(b):
    p, h, w = b.p, b.h, b.w
    kind = p.plantType
    if kind in ("tree", "conifer", "multistem"):
        trunks = 3 if kind == "multistem" else 1
        b.stem((0, 0, 0), (0, h * 0.1, 0))
        for trunk in range(trunks):
            base = (0, h * 0.1, 0)
            top = radial(trunk * 2.4, w * 0.12 if trunks > 1 else 0, h * 0.95)
            b.stem(
                base,
                top,
                b.thickness * (0.65 if trunks > 1 else 0.95),
                "cane" if kind == "multistem" and p.leafShape == "narrow" else "wood",
            )
            count = max(3, p.branchCount // trunks)
            for i in range(count):
                t = (i + 0.4) / count
                start = tuple(base[j] + (top[j] - base[j]) * (0.25 + t * 0.68) for j in range(3))
                r = w * 0.45
                if kind == "conifer" or p.crownShape == "conical":
                    r *= 1 - t * 0.88
                elif p.crownShape == "round":
                    r *= math.sin((0.14 + t * 0.72) * math.pi)
                a = i * 2.4 + trunk * 1.7 + b.rng.uniform(-0.15, 0.15)
                end = (
                    start[0] + math.cos(a) * r,
                    start[1] + min(r / math.tan(math.radians(p.branchAngle)), h * 0.22),
                    start[2] + math.sin(a) * r,
                )
                b.stem(start, end, b.thickness * (0.22 - t * 0.12))
                b.foliage(start, end, b.density * 2)
                for side in (-1, 1):
                    joint = tuple(start[j] * 0.35 + end[j] * 0.65 for j in range(3))
                    tip = (
                        joint[0] + math.cos(a + side * 0.8) * r * 0.35,
                        joint[1] + h * 0.05,
                        joint[2] + math.sin(a + side * 0.8) * r * 0.35,
                    )
                    b.stem(joint, tip, b.thickness * 0.05)
                    b.foliage(joint, tip)
                b.flower(end)
    elif kind == "grass":
        grass(b)
    elif kind == "rosette":
        count = p.branchCount * {"low": 1, "medium": 2, "high": 3}[p.leafDensity]
        b.stem((0, 0, 0), (0, h * 0.3, 0), min(0.012, h * 0.2), "herb")
        for i in range(count):
            t = i / count
            a = i * 2.39996 + b.rng.uniform(-0.1, 0.1)
            point = radial(a, w * 0.06 * (1 - t), h * (0.08 + 0.22 * t))
            b.stem((0, point[1], 0), point, 0.002, "herb")
            b.leaf(
                point,
                (math.cos(a) * w, h * (0.25 + t * 1.4), math.sin(a) * w),
                b.leaf_size * (1 - t * 0.36) * b.rng.uniform(0.95, 1.05),
            )
        b.flower((0, h * 0.5, 0))
    elif kind == "palm":
        b.stem((0, 0, 0), (0, h * 0.82, 0), kind="palm")
        count = round(p.branchCount * {"low": 0.6, "medium": 1, "high": 1.5}[p.leafDensity])
        for i in range(count):
            a = i * 2.39996 + b.rng.uniform(-0.12, 0.12)
            start = (0, h * 0.78, 0)
            end = radial(a, w * 0.30, h * b.rng.uniform(0.80, 0.95))
            b.stem(start, end, b.thickness * 0.08, "herb")
            b.leaf(
                end,
                (math.cos(a), b.rng.uniform(-0.1, 0.4), math.sin(a)),
                b.leaf_size * b.rng.uniform(0.85, 1.05),
            )
    else:
        b.stem(
            (0, 0, 0), (0, h * 0.08, 0), min(b.thickness, h * 0.08), "herb" if kind == "flower" else "wood"
        )
        for i in range(p.branchCount):
            a = i * 2.39996
            r = w * 0.38 * math.sqrt((i + 1) / p.branchCount)
            top = h * b.rng.uniform(0.65, 0.94)
            if kind != "vine":
                top *= {
                    "round": math.sqrt(1 - (r / max(w, 0.001)) ** 2),
                    "conical": 1 - r / max(w, 0.001),
                    "spreading": 0.6,
                }[p.crownShape]
            end = radial(a, r, top)
            points = b.curve(
                (0, h * 0.08, 0),
                end,
                min(b.thickness * 0.3, h * 0.02),
                "herb" if kind in ("flower", "vine") else "wood",
                bow=h * (0.12 if kind == "vine" else 0.02),
            )
            b.foliage(points[1], end, b.density * (2 if kind in ("shrub", "spreading") else 1), path=points[1:])
            b.flower(end)


def grass(b):
    for i in range(b.p.branchCount):
        a = i * 2.39996 + b.rng.uniform(-0.25, 0.25)
        root = radial(a, b.w * 0.04 * math.sqrt((i + 1) / b.p.branchCount), 0)
        base = (root[0], b.h * 0.05, root[2])
        b.stem(root, base, 0.003, "herb")
        end = radial(a, b.w * b.rng.uniform(0.18, 0.38), b.h * b.rng.uniform(0.65, 1))
        points = b.curve(base, end, 0.002, "herb", bow=b.h * 0.08)
        for j in range(b.density):
            t = 0.35 + 0.65 * j / max(1, b.density - 1)
            # Interpolate the actual rendered segments, not a separate smooth approximation.
            point = on_curve(points, t)
            # Alternate leaves along each culm; the whole tuft has radial bending frames.
            azimuth = a + (0.5 if j % 2 else -0.5) + b.rng.uniform(-0.2, 0.2)
            b.leaf(point, (0, 1, 0), b.leaf_size * b.rng.uniform(0.72, 1.04), "grass", radial(azimuth, 1, 0))
        if b.p.flowerEnabled and i % 3 == 0:
            b.flower(points[-1])
