"""Digest dedicated databases, then remove only this test's recorded, empty fixtures."""
import argparse
import os
import re
import zipfile
from pathlib import Path
from uuid import UUID

from sqlalchemy import create_engine, text

from kusakari_canvas_api.config import Settings
from kusakari_canvas_api.database import create_database_engine
from verification.deployment_preservation import digest_database
from verification.retire_product_catalog import engines, load, save


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("before", "cleanup"))
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    output = args.output_dir.resolve()
    assert output.parent.parent == Path("D:/KusakariVerification").resolve()
    normal_ec, normal_canvas = engines()
    ec = create_engine(normal_ec.url.set(database="kusakari_e2e"), hide_parameters=True)
    os.environ["KUSAKARI_CANVAS_PROFILE"] = "e2e"
    canvas = create_database_engine(Settings.from_env())
    normal_ec.dispose()
    normal_canvas.dispose()
    try:
        if args.action == "before":
            output.mkdir(exist_ok=True)
            with ec.connect() as connection:
                old_carts = list(connection.execute(text("SELECT id FROM carts")).scalars())
            save(output, "test-data-before.json", {"ec": digest_database(ec), "canvas": digest_database(canvas)})
            save(output, "preexisting-carts-private.json", old_carts)
            print("Dedicated EC/Canvas data baseline saved")
            return
        fixture = load(output, "fixtures.json")
        # Recover this run's identities from recorded evidence if a test worker was replaced.
        request_path = output / "generation-request.json"
        if request_path.is_file():
            request = load(output, request_path.name)
            fixture["productIds"] = list(set(fixture["productIds"]) | {item["productId"] for item in request["references"]})
        for trace in (output / "test-results").glob("*/trace.zip"):
            with zipfile.ZipFile(trace) as archive:
                for name in archive.namelist():
                    if name.endswith(".network"):
                        values = re.findall(r"kusakari_cart=([0-9a-f-]{36})", archive.read(name).decode("utf-8"))
                        fixture["cartIds"] = list(set(fixture["cartIds"]) | set(values))
        assert not fixture["gardenIds"], "Delete recorded test gardens through the API before cleanup"
        old_carts = set(load(output, "preexisting-carts-private.json"))
        with ec.begin() as connection:
            for identifier in fixture["productIds"]:
                assert str(UUID(identifier)) == identifier
                sku = connection.execute(text("SELECT sku FROM products WHERE id=:id"), {"id": identifier}).scalar_one()
                assert sku.startswith("AIREF-")
                for table in ("product_images", "material_products", "inventory"):
                    connection.execute(text(f"DELETE FROM {table} WHERE product_id=:id"), {"id": identifier})
                connection.execute(text("DELETE FROM products WHERE id=:id"), {"id": identifier})
            for identifier in fixture["cartIds"]:
                assert str(UUID(identifier)) == identifier and identifier not in old_carts
                row = connection.execute(text("SELECT revision, store_id FROM carts WHERE id=:id"), {"id": identifier}).one()
                assert row.revision == 0 and row.store_id == 1
                count = connection.execute(text("SELECT (SELECT COUNT(*) FROM cart_items WHERE cart_id=:id) + "
                                                "(SELECT COUNT(*) FROM orders WHERE cart_id=:id) + "
                                                "(SELECT COUNT(*) FROM cart_details WHERE cart_id=:id)"),
                                           {"id": identifier}).scalar_one()
                assert count == 0
                connection.execute(text("DELETE FROM carts WHERE id=:id"), {"id": identifier})
        after = {"ec": digest_database(ec), "canvas": digest_database(canvas)}
        assert after == load(output, "test-data-before.json"), "Pre-existing dedicated data changed"
        save(output, "test-data-after.json", {"preserved": True, "database": after,
                                            "removedTestProducts": len(fixture["productIds"]),
                                            "removedEmptyTestCarts": len(fixture["cartIds"])})
        print("PASS: test fixtures removed; all pre-existing dedicated data unchanged")
    finally:
        ec.dispose()
        canvas.dispose()


if __name__ == "__main__":
    main()
