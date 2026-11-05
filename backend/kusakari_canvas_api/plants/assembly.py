"""Resolve a v5 profile into a fixed, serializable placement of catalog v4 GLB parts."""

import json
from functools import lru_cache

import numpy as np

from ..config import REPO_ROOT
from .geometry import Builder, measure, rounded
from .growth import grow
from .schemas import ModelDimensions, ModelPart, PlantComposition, PlantProfile
from .species import resolve_traits

CATALOG_VERSION = 4


@lru_cache
def part_catalog() -> dict:
    path = REPO_ROOT / f"frontend/public/models/plant-parts/v{CATALOG_VERSION}/catalog.json"
    return json.loads(path.read_text(encoding="utf-8"))


@lru_cache
def hull_catalog() -> dict:
    return {part["id"]: {**part, "points": np.array(part["hull"])} for part in part_catalog()["parts"]}


def assemble(profile: PlantProfile) -> PlantComposition:
    return _cached(profile.model_dump_json()).model_copy(deep=True)


@lru_cache(maxsize=64)
def _cached(profile_json: str) -> PlantComposition:
    return _assemble(PlantProfile.model_validate_json(profile_json))


def _assemble(profile: PlantProfile) -> PlantComposition:
    catalog, traits = hull_catalog(), resolve_traits(profile)
    target = np.array([profile.heightCm / 100, profile.widthCm / 100])
    if profile.trunkThicknessCm / 100 >= min(target) and traits.architecture not in ("tuft", "rosette"):
        raise ValueError("幹の太さは植物の高さ・幅より小さくしてください。")

    def build(size):
        builder = Builder(profile, traits, catalog, *size)
        grow(builder)
        low, high = measure(builder.parts, catalog)
        span = high - low
        return builder.parts, low, high, np.array([high[1], max(span[0], span[2])])

    # Leaves and flowers keep their absolute size, so the outline does not scale linearly with the
    # control box. Newton steps on a measured Jacobian fit the assembled height and width.
    control = target * 0.75
    for _ in range(22):
        parts, low, high, measured = build(control)
        error = target - measured
        if np.max(np.abs(error) / target) < 0.002:
            break
        steps = np.maximum(control * 0.02, 0.001)
        columns = []
        for axis in (0, 1):
            sample = control.copy()
            sample[axis] += steps[axis]
            columns.append((build(sample)[3] - measured) / steps[axis])
        delta = np.linalg.lstsq(np.column_stack(columns), error, rcond=None)[0]
        control = np.clip(control + np.clip(delta, -control * 0.65, target) * 0.85, 0.001, target * 8)
    else:
        raise ValueError("葉・花・幹の大きさが指定した全体寸法に収まりません。葉や花を小さくするか、高さ・幅を広げてください。")
    if abs(low[1]) > 0.001:
        raise ValueError("根元を地面に接続できません。植物の寸法を確認してください。")
    if len(parts) > 1500:
        raise ValueError("部品数が上限を超えます。葉の密度や枝の数を減らしてください。")
    span = high - low
    return PlantComposition(
        version=5, catalogVersion=CATALOG_VERSION, profile=profile,
        # EC may reformat the last binary digit of stored JSON; quantize like the transforms.
        baseDimensions=ModelDimensions(width=rounded(span[0], 8), height=rounded(high[1], 8),
                                       depth=rounded(span[2], 8)),
        parts=[ModelPart(partId=p[0], position=p[1], quaternion=p[2], scale=p[3], color=p[4]) for p in parts])
