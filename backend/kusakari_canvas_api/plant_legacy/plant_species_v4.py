"""Reference-specific growth, with seeded irregularity inside botanical constraints."""

import math

from .plant_assembly import rotate
from .plant_geometry_v3 import on_curve, radial
from .plant_geometry_v4 import tapered_path


def maple(b):
    h, w, rng = b.h, b.w, b.rng
    points = [(0, 0, 0), (0, h * 0.10, 0)]
    points += [(w * 0.04 * math.sin(t * 5), h * t, w * 0.025 * t) for t in (0.25, 0.42, 0.6, 0.77, 0.94)]
    leader = tapered_path(b, points, b.thickness)
    for i in range(b.p.branchCount):
        t = (i + rng.uniform(0.15, 0.85)) / b.p.branchCount
        a = i * 2.39996 + rng.uniform(-0.5, 0.5)
        start = on_curve(leader, 0.28 + 0.68 * t)
        r = w * (0.48 - t * 0.23) * rng.uniform(0.72, 1.05)
        if b.p.crownShape == "conical":
            r *= 1 - t * 0.6
        elif b.p.crownShape == "round":
            r *= math.sin((0.18 + t * 0.65) * math.pi)
        end = (start[0] + math.cos(a) * r,
               start[1] + min(r / math.tan(math.radians(b.p.branchAngle)), h * 0.23),
               start[2] + math.sin(a) * r)
        branch = b.curve(start, end, b.thickness * (0.30 - t * 0.22), bow=h * rng.uniform(-0.015, 0.04))
        twigs = 3 if b.p.branchCount > 17 else 4
        for k in range(twigs):
            joint = on_curve(branch, 0.23 + k / (twigs - 1) * 0.72)
            spin = a + (0.8 if k % 2 else -0.8) + rng.uniform(-0.3, 0.3)
            tip = (joint[0] + math.cos(spin) * w * rng.uniform(0.12, 0.22),
                   joint[1] + h * rng.uniform(-0.025, 0.09),
                   joint[2] + math.sin(spin) * w * rng.uniform(0.12, 0.22))
            twig = b.curve(joint, tip, b.thickness * 0.035, bow=h * 0.015)
            available = (1450 - 6 - b.p.branchCount * (4 + twigs * 4)) // (b.p.branchCount * twigs * 4)
            nodes = min(available, {"low": 2, "medium": 3, "high": 5}[b.p.leafDensity])
            for j in range(nodes):
                u = 0.16 + (j + rng.uniform(0, 0.3)) / nodes * 0.83
                node = on_curve(twig, u)
                for side in (-1, 1):
                    angle = spin + side * (1.1 + rng.uniform(-0.3, 0.3))
                    size = b.leaf_size * rng.uniform(0.72, 1.1)
                    base = (node[0] + math.cos(angle) * size * 0.23, node[1] + size * 0.05,
                            node[2] + math.sin(angle) * size * 0.23)
                    b.stem(node, base, 0.001, "herb")
                    b.leaf(base, (math.cos(angle), rng.uniform(-0.3, 0.45), math.sin(angle)), size,
                           "maple-curl" if (i + j + k) % 3 == 0 else "maple")


def monstera(b):
    h, w, rng = b.h, b.w, b.rng
    vine = [(0, 0, 0), (0, h * 0.07, 0), (w * 0.025, h * 0.23, 0), (w * 0.06, h * 0.52, -w * 0.02)]
    tapered_path(b, vine, b.thickness, "herb")
    count = max(3, round(b.p.branchCount * {"low": 0.65, "medium": 1, "high": 1.4}[b.p.leafDensity]))
    for i in range(count):
        t = i / max(1, count - 1)
        a = i * 2.39996 + rng.uniform(-0.38, 0.38)
        start = on_curve(vine, 0.25 + t * 0.73)
        end = radial(a, w * (0.19 + (1 - t) * 0.10), h * (0.24 + t * 0.44))
        b.curve(start, end, b.thickness * 0.34, "herb", bow=h * rng.uniform(0.02, 0.1))
        young = i == 0 and count > 4
        size = b.leaf_size * (rng.uniform(0.50, 0.64) if young else rng.uniform(0.82, 1.08))
        # Leaves orient toward a shared light direction, not an artificial radial wheel.
        normal = (0.45 + math.cos(a) * 0.3, 0.25, 0.8 + math.sin(a) * 0.3)
        b.leaf(end, (math.cos(a) * 0.65, 0.35 + t * 0.45, math.sin(a) * 0.65), size,
               "monstera-young" if young else "monstera", normal)
    # Few downward aerial roots, joined to actual stem nodes; no unsupported floating roots.
    for i in range(2):
        start = vine[i + 1]
        end = (start[0] + w * (0.07 if i else -0.05), 0.004, start[2] - w * 0.08)
        b.curve(start, end, 0.0035, bow=-h * 0.01)


def iberis(b):
    h, w, rng = b.h, b.w, b.rng
    b.stem((0, 0, 0), (0, h * 0.04, 0), b.thickness * 0.4)
    for i in range(b.p.branchCount):
        a = i * 2.39996 + rng.uniform(-0.2, 0.2)
        r = math.sqrt((i + 0.5) / b.p.branchCount)
        end = radial(a, w * r * 0.44, h * (0.38 + (1 - r) * 0.45))
        branch = b.curve((0, h * 0.04, 0), end, b.thickness * 0.08, bow=h * 0.14)
        shoots = b.density * 2
        for j in range(shoots):
            u = 0.13 + (j + rng.uniform(0.1, 0.9)) / shoots * 0.86
            joint = on_curve(branch, u)
            angle = a + (0.9 if j % 2 else -0.9) + rng.uniform(-0.5, 0.5)
            base = (joint[0] + math.cos(angle) * w * 0.06, joint[1] + h * rng.uniform(0.02, 0.08),
                    joint[2] + math.sin(angle) * w * 0.06)
            b.stem(joint, base, 0.0012, "herb")
            shoot = b.leaf(base, (math.cos(angle) * 0.45, 1, math.sin(angle) * 0.45),
                           b.leaf_size * rng.uniform(0.8, 1.1), "iberis-v4", radial(angle, 1, 0))
            if (i + j) % 4 != 0:
                offset = rotate((0, shoot.scale[1] * 1.32, 0), shoot.quaternion)
                tip = tuple(shoot.position[k] + offset[k] for k in range(3))
                stem_offset = rotate((0, shoot.scale[1], 0), shoot.quaternion)
                stem_tip = tuple(shoot.position[k] + stem_offset[k] for k in range(3))
                b.stem(stem_tip, tip, 0.0009, "herb")
                b.flower(tip, size=b.p.flowerSizeCm / 100 * rng.uniform(0.85, 1.12), shape="iberis-v4")


def hakone(b):
    h, w, rng = b.h, b.w, b.rng
    flow = rng.uniform(0, math.pi * 2)
    for i in range(b.p.branchCount * 2):
        a = i * 2.39996 + rng.uniform(-0.4, 0.4)
        r = math.sqrt((i + 0.5) / (b.p.branchCount * 2))
        root = radial(a, w * 0.13 * r, 0)
        base = (root[0], h * 0.04, root[2])
        b.stem(root, base, 0.0016, "herb")
        spin = math.atan2(math.sin(a) * 0.75 + math.sin(flow), math.cos(a) * 0.75 + math.cos(flow))
        end = (root[0] + math.cos(a) * w * 0.18,
               h * (0.75 - r * 0.25) * rng.uniform(0.84, 1.06), root[2] + math.sin(a) * w * 0.18)
        path = b.curve(base, end, 0.0014, "herb", bow=h * 0.10)
        for j in range(b.density):
            t = 0.03 + j / max(1, b.density - 1) * 0.97
            node = on_curve(path, t)
            angle = spin + (0.6 if j % 2 else -0.6) + rng.uniform(-0.25, 0.25)
            b.leaf(node, (0, 1, 0), b.leaf_size * rng.uniform(0.78, 1.12),
                   "hakone-curl" if (i + j) % 4 == 0 else "hakone", radial(angle, 1, 0))
        if b.p.flowerEnabled and i % 4 == 0:
            b.flower(path[-1])


def goldcrest(b):
    h, w, rng = b.h, b.w, b.rng
    trunk = [(0, h * i / 10, 0) for i in range(11)]
    tapered_path(b, trunk, b.thickness)
    for i in range(b.p.branchCount * 2):
        t = (i + rng.uniform(0.1, 0.9)) / (b.p.branchCount * 2) * 0.91
        a = i * 2.39996 + rng.uniform(-0.75, 0.75)
        r = w * 0.43 * (1 - t) ** 0.8 * rng.uniform(0.82, 1.10)
        start = (0, h * (0.012 + t), 0)
        end = radial(a, r, start[1] + min(r / math.tan(math.radians(b.p.branchAngle)), h * 0.25))
        b.stem(start, end, b.thickness * (0.13 - t * 0.10))
        for j in range(b.density):
            u = 0.05 + (j + rng.uniform(0.1, 0.8)) / b.density * 0.94
            node = tuple(start[k] * (1 - u) + end[k] * u for k in range(3))
            for side in (-1, 0, 1):
                spin = a + side * 0.9 + rng.uniform(-0.2, 0.2)
                b.leaf(node, (math.cos(spin) * rng.uniform(0.12, 0.7), 1, math.sin(spin) * rng.uniform(0.12, 0.7)),
                       b.leaf_size * rng.uniform(0.72, 1.15), "goldcrest", radial(spin, 1, 0))


def botanical(builder):
    {"maple": maple, "monstera": monstera, "iberis": iberis, "hakone": hakone,
     "goldcrest": goldcrest}[builder.p.botanicalForm](builder)
