"""Five reference growth forms; leaf/flower morphology remains in versioned GLBs."""

import math

from .plant_architecture_v3 import grass
from .plant_assembly import rotate
from .plant_geometry_v3 import on_curve, radial


def maple(b):
    h, w, rng = b.h, b.w, b.rng
    b.stem((0, 0, 0), (0, h * 0.12, 0))
    b.curve((0, h * 0.12, 0), (w * 0.025, h * 0.9, 0), b.thickness * 0.9, bow=0)
    for i in range(b.p.branchCount):
        t = (i + 0.4) / b.p.branchCount
        a = i * 2.39996 + rng.uniform(-0.18, 0.18)
        radius = w * (0.46 - t * 0.20) * rng.uniform(0.85, 1.05)
        if b.p.crownShape == "conical":
            radius *= 1 - t * 0.6
        elif b.p.crownShape == "round":
            radius *= math.sin((0.15 + t * 0.7) * math.pi)
        start = (w * 0.025 * t, h * (0.32 + t * 0.48), 0)
        end = radial(a, radius, start[1] + min(radius / math.tan(math.radians(b.p.branchAngle)), h * 0.24))
        branch = b.curve(start, end, b.thickness * (0.29 - t * 0.17), bow=h * 0.03)
        for twig_index in range(3):
            fraction = 0.48 + twig_index * 0.23
            joint = on_curve(branch, fraction)
            azimuth = a + (twig_index - 1) * 0.85
            tip = (
                joint[0] + math.cos(azimuth) * w * 0.14,
                joint[1] + h * rng.uniform(0.06, 0.12),
                joint[2] + math.sin(azimuth) * w * 0.14,
            )
            b.stem(joint, tip, b.thickness * 0.045)
            nodes = max(2, b.density // 2)
            for j in range(nodes):
                u = 0.25 + j / max(1, nodes - 1) * 0.72
                node = tuple(joint[k] * (1 - u) + tip[k] * u for k in range(3))
                # Opposite pairs at each node, never seven disconnected leaflets.
                for side in (-1, 1):
                    angle = azimuth + math.pi / 2 + j * 0.45 + (math.pi if side < 0 else 0)
                    length = b.leaf_size * rng.uniform(0.78, 1.05)
                    petiole = (
                        node[0] + math.cos(angle) * length * 0.25,
                        node[1] + length * 0.07,
                        node[2] + math.sin(angle) * length * 0.25,
                    )
                    b.stem(node, petiole, 0.0012, "herb")
                    b.leaf(petiole, (math.cos(angle), rng.uniform(-0.05, 0.35), math.sin(angle)), length)


def monstera(b):
    h, w = b.h, b.w
    b.stem((0, 0, 0), (0, h * 0.6, 0), b.thickness, "herb")
    count = max(3, round(b.p.branchCount * {"low": 0.65, "medium": 1, "high": 1.4}[b.p.leafDensity]))
    for i in range(count):
        t = i / max(1, count - 1)
        a = i * 2.39996 + b.rng.uniform(-0.15, 0.15)
        start = (0, h * (0.13 + t * 0.45), 0)
        end = radial(a, w * (0.16 + (1 - t) * 0.12), h * (0.40 + t * 0.45))
        b.curve(start, end, b.thickness * 0.35, "herb", bow=h * 0.08)
        b.leaf(end, (math.cos(a), 0.05 + t * 0.5, math.sin(a)), b.leaf_size * b.rng.uniform(0.8, 1.05))


def iberis(b):
    h, w = b.h, b.w
    b.stem((0, 0, 0), (0, h * 0.03, 0), b.thickness * 0.4)
    for i in range(b.p.branchCount):
        a = i * 2.39996
        t = math.sqrt((i + 0.5) / b.p.branchCount)
        end = radial(a, w * t * 0.46, h * (0.55 + (1 - t) * 0.22))
        branch = b.curve((0, h * 0.03, 0), end, b.thickness * 0.08, bow=h * 0.12)
        shoots = b.density * 2
        for j in range(shoots):
            u = 0.12 + 0.88 * j / max(1, shoots - 1)
            joint = on_curve(branch, u)
            angle = a + (1.1 if j % 2 else -1.1) + b.rng.uniform(-0.25, 0.25)
            shoot = b.leaf(
                joint,
                (math.cos(angle) * 0.75, 1, math.sin(angle) * 0.75),
                b.leaf_size * b.rng.uniform(0.85, 1.05),
                "iberis",
                radial(angle, 1, 0),
            )
            offset = rotate((0, shoot.scale[1], 0), shoot.quaternion)
            tip = tuple(shoot.position[k] + offset[k] for k in range(3))
            b.flower(tip, shape="iberis")


def goldcrest(b):
    h, w = b.h, b.w
    # Taper the leader; a full-thickness cut trunk must not protrude through its tip.
    for i in range(8):
        b.stem((0, h * i / 8, 0), (0, h * (i + 1) / 8, 0), b.thickness * (1 - i / 8) ** 1.4)
    for i in range(b.p.branchCount * 2):
        t = 0.025 + (i + b.rng.uniform(0, 0.8)) / (b.p.branchCount * 2) * 0.92
        a = i * 2.39996 + b.rng.uniform(-0.65, 0.65)
        r = w * 0.46 * (1 - t) ** 0.8 * b.rng.uniform(0.85, 1.1)
        start = (0, h * t, 0)
        end = radial(a, r, h * t + min(r / math.tan(math.radians(b.p.branchAngle)), h * 0.20))
        b.stem(start, end, b.thickness * (0.15 - t * 0.10))
        for j in range(b.density):
            u = 0.18 + j / max(1, b.density - 1) * 0.82
            node = tuple(start[k] * (1 - u) + end[k] * u for k in range(3))
            for side in (-1, 0, 1):
                angle = a + side * 0.65
                b.leaf(
                    node,
                    (
                        math.cos(angle) * b.rng.uniform(0.15, 0.9),
                        1,
                        math.sin(angle) * b.rng.uniform(0.15, 0.9),
                    ),
                    b.leaf_size * b.rng.uniform(0.78, 1.06),
                    "scale",
                    radial(angle, 1, 0),
                )


def botanical(builder):
    {"maple": maple, "monstera": monstera, "iberis": iberis, "hakone": grass, "goldcrest": goldcrest}[
        builder.p.botanicalForm
    ](builder)
