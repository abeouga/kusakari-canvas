"""Offline resolver bridge for independent JS mesh verification (does not access any database)."""

import json
import sys
import time

from kusakari_canvas_api.plant_assembly import assemble
from kusakari_canvas_api.plant_schemas import PlantProfile

results = []
for row in json.load(sys.stdin):
    start = time.perf_counter()
    try:
        model = assemble(PlantProfile.model_validate(row["profile"]), row.get("version", 3))
        results.append(
            {"key": row["key"], "composition": model.model_dump(), "seconds": time.perf_counter() - start}
        )
    except ValueError as error:
        results.append({"key": row["key"], "error": str(error), "seconds": time.perf_counter() - start})
json.dump(results, sys.stdout)
