"""Resolve pre-authored GLB parts into a fixed, serializable placement manifest."""
import json
import math
import random
from functools import lru_cache

from .config import REPO_ROOT
from .plant_schemas import ModelDimensions, ModelPart, PlantComposition, PlantProfile


@lru_cache
def part_catalog(version: int = 4) -> dict:
    if version not in (1, 2, 3, 4):
        raise ValueError("Unknown plant catalog version")
    path = REPO_ROOT / f"frontend/public/models/plant-parts/v{version}/catalog.json"
    return json.loads(path.read_text(encoding="utf-8"))


def quaternion(direction: tuple) -> tuple:
    x, y, z = direction
    size = math.sqrt(x * x + y * y + z * z)
    x, y, z = x / size, y / size, z / size
    q = (z, 0, -x, 1 + y)
    length = math.sqrt(sum(value * value for value in q))
    if length < 1e-8:
        return (1, 0, 0, 0)
    return tuple(rounded(value / length, 8) for value in q)


def rounded(value: float, digits: int = 6) -> float:
    # JSON.stringify normalizes -0 to 0. Canonicalize here so all clients save identical data.
    result = round(value, digits)
    return 0.0 if result == 0 else result


def shifted(origin: tuple, direction: tuple, distance: float) -> tuple:
    return tuple(origin[i] + direction[i] * distance for i in range(3))


@lru_cache(maxsize=128)
def cached_v3(profile_json: str) -> PlantComposition:
    from .plant_assembly_v3 import assemble_v3
    return assemble_v3(PlantProfile.model_validate_json(profile_json), part_catalog(3))


@lru_cache(maxsize=64)
def cached_v4(profile_json: str) -> PlantComposition:
    from .plant_assembly_v4 import assemble_v4
    return assemble_v4(PlantProfile.model_validate_json(profile_json), part_catalog(4))


def assemble(profile: PlantProfile, version: int = 4) -> PlantComposition:
    if version == 4:
        return cached_v4(profile.model_dump_json()).model_copy(deep=True)
    if version == 3:
        return cached_v3(profile.model_dump_json()).model_copy(deep=True)
    if version == 2:
        from .plant_assembly_v2 import assemble_v2
        return assemble_v2(profile, part_catalog(2))
    if version != 1:
        raise ValueError("Unknown plant assembly version")
    if profile.plantType not in ("tree", "shrub", "flower") or profile.leafShape not in ("oval", "narrow", "needle") \
            or profile.flowerShape not in ("five", "eight"):
        raise ValueError("Plant features are not available in version 1")
    # Connectors are defined in the authored part catalog. All stems use base=0, tip=+Y.
    catalog = part_catalog(1)
    stem = next(part for part in catalog["parts"] if part["id"] == "stem")
    if stem["connectors"]["base"]["position"] != [0, 0, 0] \
            or stem["connectors"]["tip"]["position"] != [0, 1, 0]:
        raise ValueError("Unsupported stem connector convention")
    rng = random.Random(profile.seed)
    parts = []
    height, width = profile.heightCm / 100, profile.widthCm / 100
    leaf_size = min(profile.leafSizeCm / 100, height * 0.32, width * 0.4)
    flower_size = min(profile.flowerSizeCm / 100, width * 0.45)
    density = {"low": 3, "medium": 6, "high": 10}[profile.leafDensity]
    thickness = min(profile.trunkThicknessCm / 100, height * 0.15, width * 0.2)

    def add(part_id, origin, direction, scale, color=None):
        parts.append(ModelPart(partId=part_id, position=tuple(rounded(v) for v in origin),
                               quaternion=quaternion(direction), scale=tuple(rounded(v) for v in scale),
                               color=color))

    def foliage(origin, direction, length, count):
        for index in range(count):
            fraction = 0.25 + 0.7 * (index + 1) / count
            point = shifted(origin, direction, length * fraction)
            spin = index * 2.39996 + rng.uniform(-0.25, 0.25)
            outward = (math.cos(spin), rng.uniform(0.15, 0.8), math.sin(spin))
            size = leaf_size * rng.uniform(0.8, 1.15)
            add(f"leaf-{profile.leafShape}", point, outward, (size, size, size), profile.leafColor)
        if profile.flowerEnabled:
            tip = shifted(origin, direction, length)
            add(f"flower-{profile.flowerShape}", tip, (0, 1, 0),
                (flower_size, flower_size, flower_size), profile.flowerColor)

    if profile.plantType == "tree":
        trunk_height = height * 0.88
        add("stem", (0, 0, 0), (0, 1, 0), (thickness, trunk_height, thickness))
        for index in range(profile.branchCount):
            fraction = (index + 0.5) / profile.branchCount
            y = height * (0.32 + fraction * 0.55)
            azimuth = index * 2.39996
            radius = width * 0.42
            if profile.crownShape == "conical":
                radius *= 1.05 - fraction * 0.85
            elif profile.crownShape == "round":
                radius *= math.sin((fraction * 0.8 + 0.1) * math.pi)
            else:
                radius *= 1.0 - fraction * 0.3
            rise = min(radius / math.tan(math.radians(profile.branchAngle)), height * 0.96 - y)
            length = math.hypot(radius, rise)
            direction = (math.cos(azimuth) * radius / length, rise / length,
                         math.sin(azimuth) * radius / length)
            origin = (0, y, 0)
            branch_width = thickness * (0.42 - fraction * 0.24)
            add("stem", origin, direction, (branch_width, length, branch_width))
            foliage(origin, direction, length, density * 3)
            # Reuse the same stem and leaf GLBs for terminal twigs.
            for side in (-1, 1):
                point = shifted(origin, direction, length * 0.65)
                spin = azimuth + side * 0.7
                twig_direction = (math.cos(spin) * 0.8, 0.6, math.sin(spin) * 0.8)
                twig_length = min(length * 0.35, height * 0.15)
                add("stem", point, twig_direction, (branch_width * 0.45, twig_length, branch_width * 0.45))
                foliage(point, twig_direction, twig_length, density)
    else:
        count = profile.branchCount
        for index in range(count):
            azimuth = index * 2.39996
            fraction = (index + 1) / count
            radius = width * 0.38 * math.sqrt(fraction)
            top = height * (0.65 + rng.random() * 0.3)
            if profile.crownShape == "conical":
                top *= 1 - fraction * 0.35
            elif profile.crownShape == "round":
                top *= math.sqrt(1 - fraction * 0.45)
            else:
                top *= 0.5 + fraction * 0.3
            length = math.hypot(radius, top)
            direction = (math.cos(azimuth) * radius / length, top / length,
                         math.sin(azimuth) * radius / length)
            stem_width = min(thickness * 0.35, height * 0.025)
            add("stem", (0, 0, 0), direction, (stem_width, length, stem_width))
            foliage((0, 0, 0), direction, length, density * (2 if profile.plantType == "shrub" else 1))

    # Bounds are calculated from each authored part's local bounding box, after its saved transform.
    bounds = [[math.inf] * 3, [-math.inf] * 3]
    catalog_by_id = {part["id"]: part for part in catalog["parts"]}
    for part in parts:
        dimensions = catalog_by_id[part.partId]["baseDimensions"]
        half_width, part_height, half_depth = dimensions["width"] / 2, dimensions["height"], dimensions["depth"] / 2
        for x in (-half_width, half_width):
            for y in (0, part_height):
                for z in (-half_depth, half_depth):
                    point = rotate(tuple(v * part.scale[i] for i, v in enumerate((x, y, z))), part.quaternion)
                    for axis in range(3):
                        value = point[axis] + part.position[axis]
                        bounds[0][axis] = min(bounds[0][axis], value)
                        bounds[1][axis] = max(bounds[1][axis], value)
    # Preserve the root at ground level and uniformly fit the result to requested height.
    factor = height / bounds[1][1]
    for part in parts:
        part.position = tuple(rounded(v * factor) for v in part.position)
        part.scale = tuple(rounded(v * factor) for v in part.scale)
    actual_width = max(abs(bounds[0][0]), abs(bounds[1][0])) * 2 * factor
    actual_depth = max(abs(bounds[0][2]), abs(bounds[1][2])) * 2 * factor
    dimensions = ModelDimensions(width=width, height=height, depth=width)
    # A saved root transform fits the requested envelope while preserving every attachment.
    fit = (rounded(width / actual_width), 1.0, rounded(width / actual_depth))
    return PlantComposition(profile=profile, baseDimensions=dimensions, fitScale=fit, parts=parts)


def rotate(point: tuple, q: tuple) -> tuple:
    x, y, z = point
    qx, qy, qz, qw = q
    tx, ty, tz = 2 * (qy * z - qz * y), 2 * (qz * x - qx * z), 2 * (qx * y - qy * x)
    return (x + qw * tx + qy * tz - qz * ty, y + qw * ty + qz * tx - qx * tz,
            z + qw * tz + qx * ty - qy * tx)
