"""Versioned architecture rules using authored GLB parts and exact local bounds."""
import math
import random

from .plant_assembly import quaternion, rotate, rounded, shifted
from .plant_schemas import ModelDimensions, ModelPart, PlantComposition


def assemble_v2(profile, catalog):
    rng = random.Random(profile.seed)
    parts = []
    height, width = profile.heightCm / 100, profile.widthCm / 100
    leaf_size = min(profile.leafSizeCm / 100, height * 0.65)
    flower_size = min(profile.flowerSizeCm / 100, width * 0.7)
    thickness = min(profile.trunkThicknessCm / 100, width * 0.14, height * 0.12)
    density = {"low": 4, "medium": 7, "high": 11}[profile.leafDensity]
    kind = profile.plantType

    def add(part_id, origin, direction, scale, color=None):
        parts.append(ModelPart(partId=part_id, position=tuple(rounded(v) for v in origin),
                               quaternion=quaternion(direction), scale=tuple(rounded(v) for v in scale), color=color))

    def stem(origin, endpoint, diameter, part_id="stem-wood"):
        delta = tuple(endpoint[i] - origin[i] for i in range(3))
        length = math.sqrt(sum(v * v for v in delta))
        direction = tuple(v / length for v in delta)
        add(part_id, origin, direction, (diameter, length, diameter))
        return direction, length

    def leaf(point, direction, size, shape=None):
        add(f"leaf-{shape or profile.leafShape}", point, direction, (size, size, size), profile.leafColor)

    def flower(point):
        if profile.flowerEnabled:
            add(f"flower-{profile.flowerShape}", point, (0, 1, 0), (flower_size,) * 3, profile.flowerColor)

    def foliage(origin, direction, length, count):
        for index in range(count):
            t = 0.25 + index / max(count - 1, 1) * 0.72
            angle = index * 2.4 + rng.random() * 0.35
            leaf(shifted(origin, direction, length * t),
                 (math.cos(angle), rng.uniform(0.15, 0.65), math.sin(angle)), leaf_size * rng.uniform(0.8, 1.15))
        flower(shifted(origin, direction, length))

    if kind in ("tree", "conifer", "multistem"):
        trunks = 3 if kind == "multistem" else 1
        for trunk in range(trunks):
            angle = trunk * 2.4
            top = (math.cos(angle) * width * 0.14, height * (0.75 + trunk * 0.07), math.sin(angle) * width * 0.14) if trunks > 1 else (0, height * 0.9, 0)
            stem((0, 0, 0), top, thickness,
                 "stem-cane" if kind == "multistem" and profile.leafShape == "narrow" else "stem-wood")
            count = max(5, profile.branchCount // trunks)
            for i in range(count):
                t = (i + 0.5) / count
                origin = tuple(v * (0.28 + t * 0.65) for v in top)
                radius = width * 0.38
                if kind == "conifer" or profile.crownShape == "conical":
                    radius *= 1 - t * 0.9
                elif profile.crownShape == "round":
                    radius *= math.sin((t * 0.75 + 0.15) * math.pi)
                a = i * 2.4 + angle
                rise = min(radius / math.tan(math.radians(profile.branchAngle)), height * 0.96 - origin[1])
                endpoint = (origin[0] + math.cos(a) * radius, origin[1] + rise, origin[2] + math.sin(a) * radius)
                direction, length = stem(origin, endpoint, thickness * (0.38 - t * 0.22))
                foliage(origin, direction, length, density * 2)
                for side in (-1, 1):
                    start = shifted(origin, direction, length * 0.58)
                    end = (start[0] + math.cos(a + side * 0.8) * radius * 0.45,
                           start[1] + height * 0.10, start[2] + math.sin(a + side * 0.8) * radius * 0.45)
                    twig, twig_length = stem(start, end, thickness * 0.10)
                    foliage(start, twig, twig_length, density)
    elif kind == "palm":
        stem((0, 0, 0), (0, height * 0.72, 0), thickness, "stem-palm")
        for i in range(profile.branchCount):
            a = i * 2.4
            leaf((0, height * 0.70, 0), (math.cos(a), 0.12 + (i % 3) * 0.25, math.sin(a)), width * 0.65, "frond")
    elif kind == "rosette":
        count = profile.branchCount * 2
        for i in range(count):
            t = i / count
            a = i * 2.4
            leaf((0, height * 0.08, 0), (math.cos(a), 0.15 + t * 1.7, math.sin(a)),
                 width * (0.58 - t * 0.28))
        flower((0, height * 0.65, 0))
    elif kind == "grass":
        for i in range(profile.branchCount * 3):
            a = i * 2.4
            leaf((math.cos(a) * width * 0.06, 0, math.sin(a) * width * 0.06),
                 (math.cos(a) * 0.35, 1, math.sin(a) * 0.35), height * rng.uniform(0.65, 1.0), "grass")
        if profile.flowerEnabled:
            for i in range(max(3, profile.branchCount // 3)):
                a = i * 2.4
                endpoint = (math.cos(a) * width * 0.18, height, math.sin(a) * width * 0.18)
                stem((0, 0, 0), endpoint, height * 0.008, "stem-herb")
                flower(endpoint)
    elif kind == "vine":
        for i in range(max(3, profile.branchCount // 3)):
            a = i * 2.4
            endpoint = (math.cos(a) * width * 0.4, height * rng.uniform(0.7, 1), math.sin(a) * width * 0.4)
            direction, length = stem((0, 0, 0), endpoint, thickness, "stem-vine")
            for j in range(density * 2):
                t = (j + 1) / (density * 2)
                # Match the authored vine centerline, including its helical displacement.
                local = (math.sin(t * 7) * 0.08 * thickness, t * length, math.cos(t * 7) * 0.08 * thickness)
                point = rotate(local, quaternion(direction))
                leaf(point, (math.cos(j * 2.4), 0.25, math.sin(j * 2.4)), leaf_size)
            flower(endpoint)
    else:
        for i in range(profile.branchCount):
            a = i * 2.4
            radius = width * math.sqrt((i + 0.5) / profile.branchCount) * 0.38
            top = height * rng.uniform(0.65, 0.95)
            if kind == "spreading":
                radius *= 1.4
                top *= 0.45
            endpoint = (math.cos(a) * radius, top, math.sin(a) * radius)
            part_id = "stem-herb" if kind == "flower" else "stem-wood"
            if kind == "flower" and profile.flowerShape == "bell":
                part_id = "stem-arching"
            direction, length = stem((0, 0, 0), endpoint, min(thickness * 0.35, height * 0.018), part_id)
            if kind == "flower" and profile.leafShape == "split":
                leaf(endpoint, (math.cos(a), 0.45, math.sin(a)), leaf_size)
                flower(endpoint)
            else:
                foliage((0, 0, 0), direction, length, density * (2 if kind in ("shrub", "spreading") else 1))

    by_id = {part["id"]: part for part in catalog["parts"]}
    minimum, maximum = [math.inf] * 3, [-math.inf] * 3
    for part in parts:
        box = by_id[part.partId]["bounds"]
        for x in (box["min"][0], box["max"][0]):
            for y in (box["min"][1], box["max"][1]):
                for z in (box["min"][2], box["max"][2]):
                    point = rotate(tuple(v * part.scale[i] for i, v in enumerate((x, y, z))), part.quaternion)
                    for axis in range(3):
                        value = point[axis] + part.position[axis]
                        minimum[axis] = min(minimum[axis], value)
                        maximum[axis] = max(maximum[axis], value)
    # Translate only if an authored leaf extends below the root; fit exact authored bounds.
    bottom = min(0, minimum[1])
    for part in parts:
        part.position = (part.position[0], rounded(part.position[1] - bottom), part.position[2])
    fit = (width / (2 * max(abs(minimum[0]), abs(maximum[0]))),
           height / (maximum[1] - bottom), width / (2 * max(abs(minimum[2]), abs(maximum[2]))))
    return PlantComposition(version=2, catalogVersion=2, profile=profile,
                            baseDimensions=ModelDimensions(width=width, height=height, depth=width),
                            fitScale=tuple(rounded(v) for v in fit), parts=parts)
