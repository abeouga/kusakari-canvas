"""Explicit local catalog cleanup; archive 14 identified products, never delete rows/assets.

Prepare writes a private backup. Apply refuses drift, uses the existing EC archive API,
and verifies that only the planned active flags changed. Verify is read-only.
"""
import argparse
import hashlib
import json
from copy import deepcopy
from pathlib import Path
from urllib.request import Request, urlopen
from uuid import UUID

from sqlalchemy import bindparam, create_engine, text
from sqlalchemy.engine import make_url

from kusakari_canvas_api.config import REPO_ROOT, Settings
from kusakari_canvas_api.database import create_database_engine
from verification.deployment_preservation import digest_database

EC = "http://127.0.0.1:8086/api"
CANVAS = "http://127.0.0.1:8080/api"
RETIRED = {
    "olive": "KS-OLV-001", "lavender": "KS-LAV-001", "rosemary": "KS-ROS-001",
    "monstera": "KS-MON-001", "canvas-bench": "KS-CVS-BNC",
    "canvas-boxwood": "KS-CVS-BOX", "canvas-brick": "KS-CVS-BRK",
    "garden-demo-conifer": "KS-GDN-CONIFER", "garden-demo-herb-shrub": "KS-GDN-HERB-SHRUB",
    "garden-demo-pink-flower": "KS-GDN-PINK-FLOWER", "garden-demo-round-shrub": "KS-GDN-ROUND-SHRUB",
    "garden-demo-silver-tree": "KS-GDN-SILVER-TREE", "garden-demo-white-flower": "KS-GDN-WHITE-FLOWER",
    "98aaefac-f984-4a9f-8e99-ebc54ce86269": "DEMO-44f74404",
}
EXCEPTION = "canvas-oak"


def api(url, method="GET"):
    with urlopen(Request(url, method=method), timeout=60) as response:
        return json.load(response)


def save(output, name, value):
    with (output / name).open("x", encoding="utf-8") as file:
        json.dump(value, file, ensure_ascii=False, indent=2, default=str)


def load(output, name):
    return json.loads((output / name).read_text(encoding="utf-8"))


def engines():
    settings = Settings.from_env()
    assert settings.profile == "dev", "Only the explicitly approved local catalog is in scope"
    values = {}
    for line in (REPO_ROOT.parent / "kusakari-ec/.env").read_text(encoding="utf-8-sig").splitlines():
        key, sep, value = line.partition("=")
        if sep:
            values[key.strip()] = value.strip().strip("\"'")
    address = make_url(values["KUSAKARI_EC_DB_URL"].removeprefix("jdbc:")).set(
        drivername="mysql+pymysql", username=values["KUSAKARI_EC_DB_USER"],
        password=values["KUSAKARI_EC_DB_PASSWORD"], query={"charset": "utf8mb4"})
    assert address.host in {"localhost", "127.0.0.1"} and address.database == "kusakari"
    return create_engine(address, hide_parameters=True), create_database_engine(settings)


def products(ec):
    with ec.connect() as connection:
        rows = [dict(row) for row in connection.execute(text("SELECT * FROM products")).mappings()]
    return json.loads(json.dumps(sorted(rows, key=lambda row: row["id"]), default=str))


def catalogs():
    return [{"storeId": store["id"], "products": api(f"{EC}/products?storeId={store['id']}")}
            for store in api(f"{EC}/stores")]


def model_hash():
    with (REPO_ROOT / "frontend/public/models/tree-oak.glb").open("rb") as file:
        return hashlib.file_digest(file, "sha256").hexdigest()


def snapshot(ec, canvas):
    return {"ec": digest_database(ec), "canvas": digest_database(canvas), "treeOakSha256": model_hash()}


def reference_counts(engine, table, column):
    # Table/column identifiers below are fixed constants, not user input.
    query = text(f"SELECT {column} AS id, COUNT(*) AS count FROM {table} "
                 f"WHERE {column} IN :ids GROUP BY {column}").bindparams(bindparam("ids", expanding=True))
    with engine.connect() as connection:
        return {row.id: row.count for row in connection.execute(query, {"ids": list(RETIRED)})}


def prepare(output, ec, canvas, garden_id):
    assert not output.exists(), "Use a new backup directory; never overwrite prior evidence"
    output.mkdir()
    published = load(REPO_ROOT / "artifacts/plant-library-publication", "summary.json")
    keep = set(published["ids"]) | {EXCEPTION}
    assert published["registered"] == 30 and len(keep) == 31
    current = catalogs()
    for catalog in current:
        listed = {product["id"]: product for product in catalog["products"]}
        assert set(listed) == keep | RETIRED.keys(), "Unexpected catalog; inspect instead of deleting unknown products"
        for product_id, sku in RETIRED.items():
            assert listed[product_id]["sku"] == sku
            assert listed[product_id]["modelComposition"] is None or listed[product_id]["modelComposition"]["version"] == 1
        for product_id in published["ids"]:
            assert listed[product_id]["modelComposition"]["version"] in {3, 4}
        assert listed[EXCEPTION]["sku"] == "KS-CVS-OAK"
    assets = api(f"{CANVAS}/assets")
    oak = next(asset for asset in assets if asset["id"] == "tree_oak")
    assert oak["name"] == "木" and oak["modelUrl"] == "/models/tree-oak.glb"
    before = snapshot(ec, canvas)
    product_rows = products(ec)
    assert {row["id"] for row in product_rows if row["active"]} == keep | RETIRED.keys()
    save(output, "database-before.json", before)
    save(output, "product-rows-before.json", product_rows)
    save(output, "catalogs-before.json", current)
    save(output, "assets-before.json", assets)
    save(output, "garden-before.json", api(f"{CANVAS}/gardens/{garden_id}"))
    references = {table: reference_counts(ec, table, "product_id") for table in ("cart_items", "order_items")}
    references["placed_objects"] = reference_counts(canvas, "placed_objects", "product_id")
    with canvas.connect() as connection:
        references["legacyAssets"] = dict(connection.execute(text(
            "SELECT asset_id, COUNT(*) FROM placed_objects GROUP BY asset_id")).all())
    with ec.connect() as connection:
        # Reuse an existing empty cart read-only, avoiding a new row from GET /cart.
        empty = connection.execute(text(
            "SELECT c.id FROM carts c WHERE c.store_id=1 AND c.revision=0 "
            "AND NOT EXISTS (SELECT 1 FROM cart_items i WHERE i.cart_id=c.id) "
            "AND NOT EXISTS (SELECT 1 FROM cart_details d WHERE d.cart_id=c.id) "
            "AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.cart_id=c.id) "
            "ORDER BY c.created_at DESC LIMIT 1")).scalar_one()
    save(output, "browser-session-private.json", {"cartId": empty})
    plan = {"keepIds": sorted(keep), "retireIds": sorted(RETIRED), "gardenId": garden_id,
            "beforeCount": 45, "afterCount": 31, "references": references}
    save(output, "plan.json", plan)
    assert snapshot(ec, canvas) == before, "Data changed during preparation"
    print(json.dumps({"prepared": True, "retire": 14, "keep": 31, "references": references}, ensure_ascii=False))


def verify(output, ec, canvas, report_name):
    plan = load(output, "plan.json")
    assert plan["retireIds"] == sorted(RETIRED) and EXCEPTION in plan["keepIds"]
    expected_rows = deepcopy(load(output, "product-rows-before.json"))
    for row in expected_rows:
        if row["id"] in RETIRED:
            row["active"] = 0
    assert products(ec) == expected_rows, "Unexpected product column or row change"
    before, after = load(output, "database-before.json"), snapshot(ec, canvas)
    unchanged_before, unchanged_after = deepcopy(before), deepcopy(after)
    del unchanged_before["ec"]["products"], unchanged_after["ec"]["products"]
    assert unchanged_before == unchanged_after, "Unrelated database rows or legacy oak GLB changed"
    catalog_before = load(output, "catalogs-before.json")
    current = catalogs()
    assert len(current) == len(catalog_before)
    for old, now in zip(catalog_before, current, strict=True):
        expected = {**old, "products": [product for product in old["products"] if product["id"] not in RETIRED]}
        assert now == expected, "Retained product/price/stock/image/model changed"
        assert len(now["products"]) == 31
    assert api(f"{CANVAS}/assets") == load(output, "assets-before.json")
    assert api(f"{CANVAS}/gardens/{plan['gardenId']}") == load(output, "garden-before.json")
    save(output, report_name, {"passed": True, "archived": 14, "active": 31,
                              "allThreeStoresVerified": True, "onlyPlannedActiveFlagsChanged": True,
                              "allGardensCartsOrdersInventoryImagesUnchanged": True,
                              "treeOakSha256": after["treeOakSha256"], "databaseAfter": after})
    print("PASS: 14 archived; 30 recent products + legacy oak retained; all other data unchanged.")


def apply(output, ec, canvas):
    plan = load(output, "plan.json")
    assert plan["retireIds"] == sorted(RETIRED) and EXCEPTION not in plan["retireIds"]
    assert snapshot(ec, canvas) == load(output, "database-before.json"), "Data drift; prepare a new plan"
    assert catalogs() == load(output, "catalogs-before.json"), "Catalog drift"
    completed = []
    try:
        for product_id in plan["retireIds"]:
            assert api(f"{EC}/products/{product_id}", "DELETE") == {"deleted": True}
            completed.append(product_id)
        verify(output, ec, canvas, "apply-result.json")
    except Exception as error:
        save(output, "apply-failure.json", {"archivedIds": completed, "errorType": type(error).__name__})
        raise


def repair_profiles(output, ec, canvas):
    """Undo only the observed legacy-JSON rewrite caused by this run's old API."""
    expected = {row["id"]: row for row in load(output, "product-rows-before.json")}
    repairs = []
    current = products(ec)
    for row in current:
        old = deepcopy(expected[row["id"]])
        if row["id"] in RETIRED:
            old["active"] = 0
        if row == old:
            continue
        assert row["id"] in RETIRED and old["plant_model_profile"]
        before_profile = json.loads(old["plant_model_profile"])
        after_profile = json.loads(row["plant_model_profile"])
        assert "botanicalForm" not in before_profile
        assert after_profile == {**before_profile, "botanicalForm": None}
        assert {**row, "plant_model_profile": old["plant_model_profile"]} == old
        repairs.append((row, old["plant_model_profile"]))
    assert len(repairs) == 7, "Repair is limited to the seven observed side effects"
    save(output, "profile-repair-before.json", [row for row, _ in repairs])
    with ec.begin() as connection:
        for row, profile in repairs:
            locked = dict(connection.execute(text("SELECT * FROM products WHERE id=:id FOR UPDATE"),
                                             {"id": row["id"]}).mappings().one())
            assert json.loads(json.dumps(locked, default=str)) == row, "Concurrent product update"
            connection.execute(text("UPDATE products SET plant_model_profile=:profile WHERE id=:id"),
                               {"profile": profile, "id": row["id"]})
    verify(output, ec, canvas, "profile-repair-result.json")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("prepare", "apply", "repair-profiles", "verify"))
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--garden", help="Existing user-approved garden UUID (required for prepare)")
    args = parser.parse_args()
    if args.action == "prepare":
        if not args.garden:
            parser.error("prepare requires --garden=<existing garden UUID>")
        UUID(args.garden)
    output = args.output_dir.resolve()
    # Evidence belongs on the task-approved external drive, not inside either checkout.
    assert output.parent == Path("D:/KusakariVerification").resolve()
    ec, canvas = engines()
    try:
        if args.action == "prepare":
            prepare(output, ec, canvas, args.garden)
        elif args.action == "apply":
            apply(output, ec, canvas)
        elif args.action == "repair-profiles":
            repair_profiles(output, ec, canvas)
        else:
            verify(output, ec, canvas, "final-preservation.json")
    finally:
        ec.dispose()
        canvas.dispose()


if __name__ == "__main__":
    main()
