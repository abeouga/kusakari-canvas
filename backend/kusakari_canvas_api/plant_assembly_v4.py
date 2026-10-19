"""Fit natural v4 scaffolds; retain unchanged v3 generic forms in the new catalog."""

import numpy as np

from .plant_assembly import rounded
from .plant_assembly_v3 import assemble_v3
from .plant_geometry_v3 import bounds
from .plant_geometry_v4 import NaturalBuilder
from .plant_schemas import ModelDimensions, PlantComposition
from .plant_species_v4 import botanical


def assemble_v4(profile, catalog):
    if not profile.botanicalForm:
        return assemble_v3(profile, catalog).model_copy(update={"version": 4, "catalogVersion": 4})
    parts_catalog = {p["id"]: {**p, "points": np.array(p["hull"])} for p in catalog["parts"]}
    target = np.array([profile.heightCm / 100, profile.widthCm / 100])
    if profile.trunkThicknessCm / 100 >= min(target) and profile.plantType not in ("grass", "rosette"):
        raise ValueError("幹の太さは植物の高さ・幅より小さくしてください。")

    def build(size):
        b = NaturalBuilder(profile, parts_catalog, *size)
        botanical(b)
        low, high = bounds(b.parts, parts_catalog)
        span = high - low
        return b.parts, low, high, np.array([high[1], max(span[0], span[2])])

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
    span = high - low
    return PlantComposition(version=4, catalogVersion=4, profile=profile,
                            baseDimensions=ModelDimensions(width=rounded(float(span[0]), 8),
                                height=rounded(float(high[1]), 8), depth=rounded(float(span[2]), 8)),
                            fitScale=(1, 1, 1), parts=parts)
