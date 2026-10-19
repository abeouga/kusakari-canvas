"""Archive only the explicitly retired legacy oak; retain saved gardens and all assets."""
import argparse
from copy import deepcopy
from pathlib import Path

from verification.retire_product_catalog import (
    CANVAS,
    EC,
    api,
    catalogs,
    engines,
    load,
    products,
    save,
    snapshot,
)

GARDEN = "a9f1ae2d-b206-4c72-abf8-b4f7231bab26"


def verify(output, ec, canvas, name):
    expected = load(output, "product-rows-before.json")
    for row in expected:
        if row["id"] == "canvas-oak":
            row["active"] = 0
    assert products(ec) == expected, "Unexpected product data change"
    before, after = load(output, "database-before.json"), snapshot(ec, canvas)
    previous, current = deepcopy(before), deepcopy(after)
    del previous["ec"]["products"], current["ec"]["products"]
    assert previous == current, "Unrelated data changed"
    current_catalogs = catalogs()
    for previous_catalog, current_catalog in zip(load(output, "catalogs-before.json"), current_catalogs, strict=True):
        previous_catalog["products"] = [item for item in previous_catalog["products"] if item["id"] != "canvas-oak"]
        assert current_catalog == previous_catalog and len(current_catalog["products"]) == 30
    assert api(f"{CANVAS}/assets") == load(output, "assets-before.json")
    assert api(f"{CANVAS}/gardens/{GARDEN}") == load(output, "garden-before.json")
    save(output, name, {"passed": True, "archivedId": "canvas-oak", "active": 30,
                        "onlyOakActiveFlagChanged": True, "existingDataPreserved": True, "databaseAfter": after})
    print("PASS: 30 products in all stores; only canvas-oak active flag changed; saved gardens/assets preserved")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("prepare", "apply", "verify"))
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    output = args.output_dir.resolve()
    assert output.parent == Path("D:/KusakariVerification").resolve()
    ec, canvas = engines()
    try:
        if args.action == "prepare":
            output.mkdir(exist_ok=False)
            before = snapshot(ec, canvas)
            rows = products(ec)
            oak = next(row for row in rows if row["id"] == "canvas-oak")
            assert oak["active"] == 1 and oak["sku"] == "KS-CVS-OAK"
            assert len([row for row in rows if row["active"]]) == 31
            save(output, "database-before.json", before)
            save(output, "product-rows-before.json", rows)
            save(output, "catalogs-before.json", catalogs())
            save(output, "assets-before.json", api(f"{CANVAS}/assets"))
            save(output, "garden-before.json", api(f"{CANVAS}/gardens/{GARDEN}"))
            assert snapshot(ec, canvas) == before
            print("Prepared private backup; target: canvas-oak only")
        elif args.action == "apply":
            assert snapshot(ec, canvas) == load(output, "database-before.json"), "Data drift"
            assert api(f"{EC}/products/canvas-oak", "DELETE") == {"deleted": True}
            verify(output, ec, canvas, "archive-result.json")
        else:
            verify(output, ec, canvas, "final-preservation.json")
    finally:
        ec.dispose()
        canvas.dispose()


if __name__ == "__main__":
    main()
