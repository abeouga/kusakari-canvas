"""Fit the branching scaffold, never anisotropically stretch leaf/flower meshes."""

import numpy as np

from .plant_architecture_v3 import generic
from .plant_assembly import rounded
from .plant_geometry_v3 import PlantBuilder, bounds
from .plant_schemas import ModelDimensions, PlantComposition


def assemble_v3(profile, catalog):
    from .plant_species_v3 import botanical

    parts_catalog = {p["id"]: {**p, "points": np.array(p["hull"])} for p in catalog["parts"]}
    target = np.array([profile.heightCm / 100, profile.widthCm / 100])
    if profile.trunkThicknessCm / 100 >= min(target) and profile.plantType not in ("grass", "rosette"):
        raise ValueError("幹の太さは植物の高さ・幅より小さくしてください。")

    def build(size):
        builder = PlantBuilder(profile, parts_catalog, *size)
        (botanical if profile.botanicalForm else generic)(builder)
        lo, hi = bounds(builder.parts, parts_catalog)
        span = hi - lo
        return builder.parts, lo, hi, np.array([hi[1], max(span[0], span[2])])

    control = target * 0.75
    for _ in range(18):
        parts, low, high, measured = build(control)
        error = target - measured
        if np.max(np.abs(error) / target) < 0.002:
            break
        # Independent finite-difference measurement of the assembled geometry's response.
        steps = np.maximum(control * 0.02, 0.001)
        columns = []
        for axis in (0, 1):
            sample = control.copy()
            sample[axis] += steps[axis]
            columns.append((build(sample)[3] - measured) / steps[axis])
        jacobian = np.column_stack(columns)
        delta = np.linalg.lstsq(jacobian, error, rcond=None)[0]
        control = np.clip(control + np.clip(delta, -control * 0.65, target) * 0.85, 0.001, target * 8)
    else:
        raise ValueError(
            "葉・花・幹の大きさが指定した全体寸法に収まりません。葉や花を小さくするか、高さ・幅を広げてください。"
        )
    if low[1] < -0.001 or low[1] > 0.001:
        raise ValueError("根元を地面に接続できません。植物の寸法を確認してください。")
    span = high - low
    return PlantComposition(
        version=3,
        catalogVersion=3,
        profile=profile,
        # JSON storage in EC may reformat the last binary-double digit. Quantize the
        # measurements just like transforms so exact canonical validation survives it.
        baseDimensions=ModelDimensions(
            width=rounded(float(span[0]), 8),
            height=rounded(float(high[1]), 8),
            depth=rounded(float(span[2]), 8),
        ),
        fitScale=(1, 1, 1),
        parts=parts,
    )
