"""Read-only business-data digests before/after local deployment refactoring."""
import argparse
import hashlib
import json
from pathlib import Path

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import make_url

from kusakari_canvas_api.config import REPO_ROOT, Settings
from kusakari_canvas_api.database import create_database_engine


def digest_database(engine):
    result = {}
    with engine.connect() as connection:
        for table in sorted(inspect(connection).get_table_names()):
            if table in {"alembic_version", "flyway_schema_history"}:
                continue
            # Table identifiers come only from the database inspector.
            table_id = connection.dialect.identifier_preparer.quote(table)
            rows = []
            for row in connection.execute(text(f"SELECT * FROM {table_id}")).mappings():
                content = {key: {"sha256": hashlib.sha256(value).hexdigest()} if isinstance(value, bytes) else value
                           for key, value in row.items()
                           if not (key in {"before_key", "after_key", "image_key"} and value is None)}
                rows.append(json.dumps(content, sort_keys=True, default=str))
            digest = hashlib.sha256("\n".join(sorted(rows)).encode()).hexdigest()
            result[table] = {"count": len(rows), "sha256": digest}
    return result


def inspect_cart_growth(engine, baseline):
    """Explain additions without weakening the full-database equality assertion."""
    with engine.connect() as connection:
        rows = list(connection.execute(text("SELECT * FROM carts ORDER BY created_at, id")).mappings())
        previous, added = rows[:baseline["count"]], rows[baseline["count"]:]
        encoded = sorted(json.dumps(dict(row), sort_keys=True, default=str) for row in previous)
        unchanged = len(previous) == baseline["count"] and hashlib.sha256(
            "\n".join(encoded).encode()).hexdigest() == baseline["sha256"]
        empty = True
        for row in added:
            linked = connection.execute(text("SELECT (SELECT COUNT(*) FROM cart_items WHERE cart_id=:id) + "
                                             "(SELECT COUNT(*) FROM cart_details WHERE cart_id=:id) + "
                                             "(SELECT COUNT(*) FROM orders WHERE cart_id=:id)"),
                                        {"id": row["id"]}).scalar_one()
            empty = empty and linked == 0 and row["revision"] == 0 and row["store_id"] == 1
    return {"originalCount": baseline["count"], "originalRowsUnchanged": unchanged,
            "addedCount": len(added), "additionsAreEmptyUnmodifiedCarts": empty,
            "additionTimes": [str(row["created_at"]) for row in added], "rowsDeleted": 0 if unchanged else None}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("before", "after"))
    parser.add_argument("--ec-root", type=Path, default=REPO_ROOT.parent / "kusakari-ec")
    parser.add_argument("--output-dir", type=Path, default=REPO_ROOT / "artifacts/deployment-refactor")
    parser.add_argument("--baseline", type=Path, help="Existing baseline to compare without modifying it (after only)")
    args = parser.parse_args()
    if args.baseline is not None and args.action != "after":
        parser.error("--baseline is only valid with after")
    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=True)
    baseline = args.baseline.resolve(strict=True) if args.baseline is not None else output / "business-data-before.json"
    expected = json.loads(baseline.read_text(encoding="utf-8")) if args.action == "after" else None
    values = {}
    for line in (args.ec_root / ".env").read_text(encoding="utf-8-sig").splitlines():
        key, sep, value = line.partition("=")
        if sep:
            values[key.strip()] = value.strip().strip("\"'")
    address = make_url(values["KUSAKARI_EC_DB_URL"].removeprefix("jdbc:")).set(
        drivername="mysql+pymysql", username=values["KUSAKARI_EC_DB_USER"],
        password=values["KUSAKARI_EC_DB_PASSWORD"], query={"charset": "utf8mb4"})
    ec = create_engine(address, hide_parameters=True)
    canvas = create_database_engine(Settings.from_env())
    try:
        snapshot = {"ec": digest_database(ec), "canvas": digest_database(canvas)}
        growth = inspect_cart_growth(ec, expected["ec"]["carts"]) if expected and snapshot["ec"]["carts"] != expected["ec"]["carts"] else None
    finally:
        ec.dispose()
        canvas.dispose()
    if args.action == "before":
        with baseline.open("x", encoding="utf-8") as file:
            json.dump(snapshot, file, indent=2)
    else:
        changes = [{"database": database, "table": table, "before": expected[database].get(table),
                    "current": snapshot[database].get(table)}
                   for database in sorted(expected)
                   for table in sorted(expected[database].keys() | snapshot[database].keys())
                   if expected[database].get(table) != snapshot[database].get(table)]
        (output / "business-data-comparison.json").write_text(
            json.dumps({"matched": not changes, "changes": changes, "cartGrowthEvidence": growth}, indent=2), encoding="utf-8")
        assert not changes, "Business data changed; inspect the digest-only comparison report."
        (output / "business-data-after.json").write_text(json.dumps(snapshot, indent=2), encoding="utf-8")
    print(json.dumps({"action": args.action, "matched": args.action == "after",
                      "tables": {name: len(tables) for name, tables in snapshot.items()}}))


if __name__ == "__main__":
    main()
