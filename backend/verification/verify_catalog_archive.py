"""Regression against real EC API + dedicated MySQL; leave pre-existing test data intact."""
import argparse
import json
from copy import deepcopy
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from uuid import uuid4

from sqlalchemy import MetaData, Table, create_engine, delete, insert, text

from verification.deployment_preservation import digest_database
from verification.retire_product_catalog import engines, load, save

BASE = "http://127.0.0.1:18186/api"


def request(path, method="GET", body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = Request(BASE + path, method=method, data=data, headers={"Content-Type": "application/json"})
    try:
        with urlopen(req, timeout=30) as response:
            return response.status, json.load(response)
    except HTTPError as error:
        return error.code, json.load(error)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    output = parser.parse_args().output_dir.resolve()
    assert output.parent == Path("D:/KusakariVerification").resolve()
    normal, canvas = engines()
    database = create_engine(normal.url.set(database="kusakari_e2e"), hide_parameters=True)
    normal.dispose()
    canvas.dispose()
    identifier = str(uuid4())
    before = digest_database(database)
    checks = []
    cleanup_tables = []
    try:
        metadata = MetaData()
        product_table = Table("products", metadata, autoload_with=database)
        cleanup_tables.append(product_table)
        inventory_table = Table("inventory", metadata, autoload_with=database)
        cleanup_tables.append(inventory_table)
        materials = Table("material_products", metadata, autoload_with=database)
        cleanup_tables.append(materials)
        # Preserve missing botanicalForm exactly, reproducing the original defect.
        old = next(row for row in load(output, "product-rows-before.json") if row["id"] == "garden-demo-conifer")
        fixture = {**old, "id": identifier, "sku": "ARCHIVE-" + identifier[:12], "active": 1}
        for field in ("plant_model_profile", "model_composition"):
            fixture[field] = json.loads(fixture[field])
        assert "botanicalForm" not in fixture["plant_model_profile"]
        with database.begin() as connection:
            connection.execute(insert(product_table), fixture)
            connection.execute(insert(inventory_table), {"store_id": 1, "product_id": identifier, "quantity": 20})
            connection.execute(insert(materials), {"material_code": "product." + identifier, "product_id": identifier})

        def row():
            with database.connect() as connection:
                return dict(connection.execute(text("SELECT * FROM products WHERE id=:id"), {"id": identifier}).mappings().one())

        original = row()
        status, listed = request("/products?storeId=1")
        assert status == 200 and any(product["id"] == identifier for product in listed)
        checks.append("fixture-visible-on-dedicated-api")
        query = {"storeId": 1, "items": [{"materialCode": "product." + identifier, "quantity": 1, "unit": "piece"}]}
        status, matched = request("/materials/quote", "POST", query)
        assert status == 200 and matched[0]["status"] == "MATCHED"
        checks.append("active-material-match")
        assert request(f"/products/{identifier}", "DELETE") == (200, {"deleted": True})
        expected = {**deepcopy(original), "active": 0}
        assert row() == expected
        checks.append("archive-changes-only-active-legacy-json-byte-identical")
        assert request(f"/products/{identifier}", "DELETE") == (200, {"deleted": True})
        assert row() == expected
        checks.append("repeat-archive-idempotent")
        status, listed = request("/products?storeId=1")
        assert status == 200 and not any(product["id"] == identifier for product in listed)
        checks.append("archived-product-not-listed")
        status, matched = request("/materials/quote", "POST", query)
        assert status == 200 and matched[0]["status"] == "UNMAPPED" and not matched[0]["candidates"]
        checks.append("archived-product-not-quoted")
        status, error = request(f"/products/{uuid4()}", "DELETE")
        assert status == 404 and error["code"] == "PRODUCT_NOT_FOUND"
        checks.append("missing-product-404")
    finally:
        # Only this run's random fixture is removed; no schema reset/seed replacement.
        with database.begin() as connection:
            for table in reversed(cleanup_tables):
                column = table.c.id if table.name == "products" else table.c.product_id
                connection.execute(delete(table).where(column == identifier))
        assert digest_database(database) == before, "Pre-existing E2E data changed"
        database.dispose()
    checks.append("all-preexisting-e2e-data-preserved")
    save(output, "archive-regression.json", {"passed": True, "database": "kusakari_e2e", "checks": checks})
    print(f"PASS: {len(checks)} archive regression checks; dedicated fixture removed.")


if __name__ == "__main__":
    main()
