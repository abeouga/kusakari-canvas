import hashlib
import json
from dataclasses import replace
from datetime import UTC, datetime
from uuid import uuid4

from PIL import Image
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from alembic import command
from kusakari_canvas_api.ai_config import MODEL, QUALITY
from kusakari_canvas_api.ai_images import png_bytes
from kusakari_canvas_api.config import BACKEND_ROOT
from kusakari_canvas_api.database import create_database_engine
from kusakari_canvas_api.history_schemas import HistorySaveRequest
from kusakari_canvas_api.history_service import get_history, image_data_url, save_history
from kusakari_canvas_api.migrations import HEAD, alembic_config, current_revision, migrate, validate_schema
from kusakari_canvas_api.schemas import CreateGardenRequest, GardenDocument, GardenDocumentRequest
from kusakari_canvas_api.service import create_garden, update_garden


def data_digest(connection, *, include_generation_method: bool = True) -> str:
    rows = {}
    tables = set(inspect(connection).get_table_names())
    for table in ("assets", "gardens", "placed_objects", "flyway_schema_history", "garden_image_history"):
        if table not in tables:
            continue
        values = []
        for row in connection.execute(text(f"SELECT * FROM {table} ORDER BY 1")).mappings():
            # New seed and nullable extension fields do not modify pre-existing business data.
            if table == "assets" and row["id"] == "plant_modular":
                continue
            values.append({key: {"sha256": hashlib.sha256(value).hexdigest()} if isinstance(value, bytes) else value
                           for key, value in row.items() if (include_generation_method or key != "generation_method")
                           and not (key in {"product_id", "product_name", "material_code", "model_composition_json",
                                            "before_key", "after_key", "image_key"}
                                    and value is None)})
        # A newly added empty history table must not change the legacy-data fingerprint.
        if table != "garden_image_history" or values:
            rows[table] = values
    return hashlib.sha256(json.dumps(rows, default=str, sort_keys=True).encode()).hexdigest()


def history_fixture(engine, owner: str, *, legacy: bool = False) -> HistorySaveRequest:
    before = image_data_url(png_bytes(Image.new("RGBA", (2, 2), (80, 120, 60, 255))))
    after = image_data_url(png_bytes(Image.new("RGBA", (2, 2), (60, 160, 50, 255))))
    corners = [{"x": 0, "y": 1}, {"x": 1, "y": 1}, {"x": 1, "y": 0}, {"x": 0, "y": 0}]
    with Session(engine, expire_on_commit=False) as session:
        garden = create_garden(session, owner, CreateGardenRequest(name="history migration sentinel"))
        snapshot = garden.model_dump()
        snapshot["photo"] = {"dataUrl": before, "imageWidth": 2, "imageHeight": 2,
                             "corners": corners, "boundary": corners}
        snapshot["objects"] = [{"id": str(uuid4()), "assetId": "tree_oak",
                                "position": {"x": 0, "y": 0, "z": 0},
                                "rotation": {"x": 0, "y": 0, "z": 0},
                                "scale": {"x": 1, "y": 1, "z": 1}}]
        if legacy:
            # The fixture must use the historical schema, not the current ORM's added columns.
            snapshot["revision"] = 1
            document = GardenDocument.model_validate(snapshot)
            obj = document.objects[0]
            with session.begin():
                session.execute(text("UPDATE gardens SET revision=1, photo_json=:photo WHERE id=:id"),
                                {"id": garden.id, "photo": document.photo.model_dump_json()})
                session.execute(text(
                    "INSERT INTO placed_objects (id,garden_id,asset_id,position_x,position_y,position_z,"
                    "rotation_x,rotation_y,rotation_z,scale_x,scale_y,scale_z) "
                    "VALUES (:id,:garden,'tree_oak',0,0,0,0,0,0,1,1,1)"),
                    {"id": obj.id, "garden": garden.id})
        else:
            document = update_garden(session, owner, garden.id, GardenDocumentRequest.model_validate(snapshot))
        request = HistorySaveRequest(
            id=uuid4(), document=GardenDocumentRequest.model_validate(document.model_dump()),
            beforeDataUrl=before, afterDataUrl=after, model=MODEL, quality=QUALITY, inputImageCount=2,
            generationMethod="masked_composite_v1" if legacy else "full_frame_v1",
            referenceSummary=[{"assetId": "tree_oak", "productId": "migration-test-product",
                               "productName": "migration sentinel", "source": "uploaded"}],
        )
        if not legacy:
            save_history(session, owner, garden.id, request)
            return request
    # Insert only 0003 columns, with the exact pre-method fingerprint format.
    metadata = request.model_dump(mode="json", exclude={"beforeDataUrl", "afterDataUrl", "generationMethod"})
    canonical = json.dumps(metadata, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
    before_png = png_bytes(Image.new("RGBA", (2, 2), (80, 120, 60, 255)))
    after_png = png_bytes(Image.new("RGBA", (2, 2), (60, 160, 50, 255)))
    fingerprint = hashlib.sha256(canonical.encode("utf-8"))
    for content in (before_png, after_png):
        fingerprint.update(len(content).to_bytes(8, "big"))
        fingerprint.update(content)
    values = {
        "id": str(request.id), "garden_id": request.document.id,
        "created_at": datetime.now(UTC).replace(tzinfo=None), "width": 2, "height": 2,
        "model": MODEL, "quality": QUALITY, "input_image_count": 2,
        "reference_summary_json": json.dumps([item.model_dump() for item in request.referenceSummary]),
        "snapshot_revision": request.document.revision, "snapshot_json": request.document.model_dump_json(),
        "before_png": before_png, "after_png": after_png, "payload_sha256": fingerprint.hexdigest(),
    }
    with engine.begin() as connection:
        connection.execute(text(
            "INSERT INTO garden_image_history (id,garden_id,created_at,width,height,model,quality,"
            "input_image_count,reference_summary_json,snapshot_revision,snapshot_json,before_png,after_png,payload_sha256) "
            "VALUES (:id,:garden_id,:created_at,:width,:height,:model,:quality,:input_image_count,"
            ":reference_summary_json,:snapshot_revision,:snapshot_json,:before_png,:after_png,:payload_sha256)"), values)
    return request


def legacy_fixture(connection, version: int) -> None:
    files = ["V1__create_garden_tables_and_seed_assets.sql", "V2__garden_photo.sql"]
    for filename in files[:version]:
        source = (BACKEND_ROOT / "alembic/sql" / filename).read_text(encoding="utf-8-sig")
        for sql in source.split(";"):
            if sql.strip():
                connection.execute(text(sql.strip()))
    connection.execute(text("CREATE TABLE flyway_schema_history (installed_rank INT NOT NULL PRIMARY KEY, "
                            "version VARCHAR(50), type VARCHAR(20) NOT NULL, success BOOLEAN NOT NULL) ENGINE=InnoDB"))
    for rank in range(1, version + 1):
        connection.execute(text("INSERT INTO flyway_schema_history VALUES (:rank,:version,'SQL',true)"),
                           {"rank": rank, "version": str(rank)})
    connection.execute(text("INSERT INTO gardens (id,owner_id,name,width,depth,revision,updated_at) "
                            "VALUES (:id,'kusakari-canvas-e2e-demo','migration sentinel',10,8,7,'2026-01-01 00:00:00.123456')"),
                       {"id": "12345678-1234-4321-8321-123456789012"})
    if version == 2:
        connection.execute(text("UPDATE gardens SET photo_json='{}'"))
    connection.commit()


def verify_migrations(settings) -> list[dict]:
    admin = create_database_engine(settings)
    results = []
    # Only databases created successfully by this invocation can be removed.
    created = []
    try:
        scenarios = ("fresh", "v1", "v2", "alembic_v1", "alembic_v2", "alembic_v3", "alembic_v3_history",
                     "head_history", "mismatch", "failed_history")
        for scenario in scenarios:
            name = f"kusakari_canvas_e2e_migration_{uuid4().hex[:12]}"
            with admin.connect() as connection:
                connection.execute(text(f"CREATE DATABASE `{name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci"))
                created.append(name)
            fixture = replace(settings, database_url=settings.database_url.set(database=name))
            engine = create_database_engine(fixture)
            try:
                before = None
                legacy_request = None
                include_method = scenario != "alembic_v3_history"
                if scenario == "head_history":
                    migrate(fixture)
                    history_fixture(engine, settings.owner_id)
                    with engine.connect() as connection:
                        before = data_digest(connection)
                elif scenario in {"alembic_v3", "alembic_v3_history"}:
                    with engine.connect() as connection:
                        command.upgrade(alembic_config(connection), "0003")
                        connection.commit()
                        validate_schema(connection, "0003")
                    if scenario == "alembic_v3_history":
                        legacy_request = history_fixture(engine, settings.owner_id, legacy=True)
                    with engine.connect() as connection:
                        before = data_digest(connection, include_generation_method=include_method)
                elif scenario != "fresh":
                    with engine.connect() as connection:
                        version = 2 if scenario in {"v2", "alembic_v2"} else 1
                        legacy_fixture(connection, version)
                        if scenario.startswith("alembic_"):
                            # Adopt a valid earlier Alembic revision without upgrading the fixture.
                            command.stamp(alembic_config(connection), f"000{version}")
                            connection.commit()
                            validate_schema(connection, f"000{version}")
                        if scenario == "mismatch":
                            connection.execute(text("ALTER TABLE gardens MODIFY width INT NOT NULL"))
                        if scenario == "failed_history":
                            connection.execute(text("UPDATE flyway_schema_history SET success=false"))
                        connection.commit()
                        before = data_digest(connection)
                if scenario in {"mismatch", "failed_history"}:
                    try:
                        migrate(fixture)
                    except ValueError:
                        pass
                    else:
                        raise AssertionError("Unsafe schema/history was adopted")
                    with engine.connect() as connection:
                        assert "alembic_version" not in inspect(connection).get_table_names()
                        assert data_digest(connection) == before
                    results.append({"scenario": scenario, "result": "rejected before stamp/DDL"})
                else:
                    result = migrate(fixture)
                    with engine.connect() as connection:
                        validate_schema(connection, HEAD)
                        assert current_revision(connection) == HEAD
                        method_column = next(column for column in inspect(connection).get_columns("garden_image_history")
                                             if column["name"] == "generation_method")
                        assert method_column["default"] is None
                        if scenario in {"v2", "alembic_v2", "alembic_v3", "alembic_v3_history", "head_history"}:
                            assert data_digest(connection, include_generation_method=include_method) == before
                        if scenario in {"v1", "alembic_v1"}:
                            row = connection.execute(text("SELECT revision,photo_json FROM gardens")).one()
                            assert tuple(row) == (7, None)
                        if scenario == "fresh":
                            assert set(connection.scalars(text("SELECT id FROM assets"))) == {
                                "tree_oak", "shrub_boxwood", "brick_paver", "bench_wood", "plant_modular"
                            }
                        history_count = 1 if scenario in {"head_history", "alembic_v3_history"} else 0
                        assert connection.scalar(text("SELECT COUNT(*) FROM garden_image_history")) == history_count
                        if legacy_request is not None:
                            assert connection.scalar(text("SELECT generation_method FROM garden_image_history")) \
                                == "masked_composite_v1"
                        preserved = data_digest(connection)
                    if legacy_request is not None:
                        with Session(engine, expire_on_commit=False) as session:
                            saved = save_history(session, settings.owner_id, legacy_request.document.id, legacy_request)
                            assert saved.id == str(legacy_request.id)
                            restored = get_history(session, settings.owner_id, legacy_request.document.id, saved.id)
                            assert restored.beforeDataUrl == legacy_request.beforeDataUrl
                            assert restored.afterDataUrl == legacy_request.afterDataUrl
                            assert restored.document == legacy_request.document
                        with engine.connect() as connection:
                            assert data_digest(connection) == preserved
                    second = migrate(fixture)
                    assert second["previous"] == HEAD and second["backup"] is None
                    with engine.connect() as connection:
                        assert data_digest(connection) == preserved
                    results.append({"scenario": scenario, "result": "passed", "backup": bool(result["backup"]),
                                    "repeat_start_preserved": True})
            finally:
                engine.dispose()
        return results
    finally:
        with admin.connect() as connection:
            for name in created:
                prefix = "kusakari_canvas_e2e_migration_"
                if not name.startswith(prefix) or len(name) != len(prefix) + 12:
                    raise RuntimeError("Unsafe test database cleanup name")
                connection.execute(text(f"DROP DATABASE `{name}`"))
        admin.dispose()
