import hashlib
import os
import re
import shutil
import subprocess
from datetime import UTC, datetime
from pathlib import Path

from alembic.config import Config
from sqlalchemy import Connection, inspect, text

from alembic import command

from .config import BACKEND_ROOT, Settings
from .database import create_database_engine
from .history_models import HistoryEntity  # noqa: F401 - register history metadata for schema validation
from .models import Base

HEAD = "0007"
SUPPORTED_REVISIONS = {"0001", "0002", "0003", "0004", "0005", "0006", HEAD}


def migration_lock_name(database: str) -> str:
    prefix = "kusakari_canvas_migrate_"
    digest_length = 64 - len(prefix)
    database_digest = hashlib.sha256(database.encode("utf-8")).hexdigest()[:digest_length]
    return prefix + database_digest


def type_signature(value, dialect) -> str:
    # MySQL may report legacy integer display widths (e.g. BIGINT(20)).
    compiled = value.compile(dialect=dialect).upper().replace(" ", "")
    return re.sub(r"\b(BIGINT|INTEGER|INT)\(\d+\)", r"\1", compiled)


def validate_schema(connection: Connection, revision: str) -> None:
    if revision not in SUPPORTED_REVISIONS:
        raise ValueError("Unknown Kusakari Canvas schema revision; migration stopped.")
    inspector = inspect(connection)
    names = set(inspector.get_table_names())
    expected_tables = set()
    for table in Base.metadata.sorted_tables:
        if table.name == "garden_image_history" and revision in {"0001", "0002"}:
            continue
        if table.name == "garden_thumbnails" and revision not in {"0006", "0007"}:
            continue
        expected_tables.add(table.name)
    allowed = expected_tables | {"flyway_schema_history", "alembic_version"}
    if not expected_tables <= names or names - allowed:
        raise ValueError("Database tables do not match the Kusakari Canvas schema; migration stopped.")
    for table in Base.metadata.sorted_tables:
        if table.name not in expected_tables:
            continue
        expected = {}
        for column in table.columns:
            if revision == "0001" and table.name == "gardens" and column.name == "photo_json":
                continue
            if revision in {"0001", "0002", "0003"} and table.name == "garden_image_history" and column.name == "generation_method":
                continue
            if revision not in {"0005", "0006", "0007"} and table.name == "placed_objects" and column.name in {
                "product_id", "product_name", "material_code", "model_composition_json"
            }:
                continue
            if revision != "0007" and table.name in {"garden_image_history", "garden_thumbnails"} and column.name.endswith("_key"):
                continue
            expected[column.name] = column
        actual = {c["name"]: c for c in inspector.get_columns(table.name)}
        if set(expected) != set(actual):
            raise ValueError(f"Schema column mismatch: {table.name}; migration stopped.")
        for name, column in expected.items():
            found = actual[name]
            nullable = column.nullable
            if revision != "0007" and table.name in {"garden_image_history", "garden_thumbnails"} and name.endswith("_png"):
                nullable = False
            if type_signature(column.type, connection.dialect) != type_signature(found["type"], connection.dialect) \
                    or bool(nullable) != bool(found["nullable"]):
                raise ValueError(f"Schema type/nullability mismatch: {table.name}.{name}; migration stopped.")
        if inspector.get_pk_constraint(table.name)["constrained_columns"] != [c.name for c in table.primary_key]:
            raise ValueError(f"Schema primary key mismatch: {table.name}; migration stopped.")
        indexes = {i["name"]: (i["column_names"], bool(i["unique"])) for i in inspector.get_indexes(table.name)}
        expected_indexes = {i.name: ([c.name for c in i.columns], bool(i.unique)) for i in table.indexes}
        # InnoDB automatically creates the supporting index for the asset foreign key.
        for name, signature in expected_indexes.items():
            if indexes.get(name) != signature:
                raise ValueError(f"Schema index mismatch: {table.name}.{name}; migration stopped.")
        if any(unique for _columns, unique in indexes.values()):
            raise ValueError(f"Unexpected unique index: {table.name}; migration stopped.")
        options = inspector.get_table_options(table.name)
        if options.get("mysql_engine", "").lower() != "innodb":
            raise ValueError(f"Nontransactional table: {table.name}; migration stopped.")
        actual_fks = {(tuple(f["constrained_columns"]), f["referred_table"], tuple(f["referred_columns"]),
                       f.get("options", {}).get("ondelete", "").upper())
                      for f in inspector.get_foreign_keys(table.name)}
        expected_fks = {(tuple(f.parent.name for f in fk.elements), fk.referred_table.name,
                         tuple(f.column.name for f in fk.elements), (fk.ondelete or "").upper())
                        for fk in table.foreign_key_constraints}
        if actual_fks != expected_fks:
            raise ValueError(f"Schema foreign key mismatch: {table.name}; migration stopped.")


def current_revision(connection: Connection) -> str | None:
    if "alembic_version" not in inspect(connection).get_table_names():
        return None
    rows = list(connection.scalars(text("SELECT version_num FROM alembic_version")))
    if len(rows) != 1 or rows[0] not in SUPPORTED_REVISIONS:
        raise ValueError("Alembic history is empty, branched, or unsupported; migration stopped.")
    return rows[0]


def legacy_revision(connection: Connection) -> str:
    if "flyway_schema_history" not in inspect(connection).get_table_names():
        raise ValueError("Existing schema has no known migration history; migration stopped.")
    rows = list(connection.execute(text(
        "SELECT version, type, success FROM flyway_schema_history ORDER BY installed_rank")).mappings())
    versions = [str(row["version"]) for row in rows]
    if versions not in (["1"], ["1", "2"]) or any(not r["success"] or r["type"] != "SQL" for r in rows):
        raise ValueError("Flyway history does not match V1/V2; migration stopped.")
    revision = "0001" if versions == ["1"] else "0002"
    validate_schema(connection, revision)
    return revision


def backup_database(settings: Settings) -> Path:
    mysql_bin = os.environ.get("KUSAKARI_CANVAS_MYSQL_BIN")
    executable = str(Path(mysql_bin) / "mysqldump.exe") if mysql_bin else None
    if executable is None or not Path(executable).is_file():
        executable = shutil.which("mysqldump.exe") or shutil.which("mysqldump")
    if executable is None:
        raise ValueError("mysqldump is required before changing an existing database.")
    settings.backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")
    path = settings.backup_dir / f"{settings.database_url.database}-{stamp}.sql"
    env = os.environ.copy()
    env["MYSQL_PWD"] = settings.database_url.password or ""
    args = [executable, "--single-transaction", "--hex-blob", "--set-gtid-purged=OFF", "--no-tablespaces",
            "--column-statistics=0", "--default-character-set=utf8mb4", "--protocol=TCP",
            f"--host={settings.database_url.host}", f"--port={settings.database_url.port}",
            f"--user={settings.database_url.username}", settings.database_url.database]
    with path.open("xb") as output:
        result = subprocess.run(args, env=env, stdout=output, stderr=subprocess.PIPE, timeout=120, check=False)
    if result.returncode or path.stat().st_size == 0:
        path.unlink(missing_ok=True)
        raise ValueError("Database backup failed; no migration was started. Check mysqldump permissions.")
    return path


def alembic_config(connection: Connection) -> Config:
    config = Config(str(BACKEND_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_ROOT / "alembic"))
    config.attributes["connection"] = connection
    return config


def migrate(settings: Settings) -> dict:
    engine = create_database_engine(settings)
    backup = None
    try:
        with engine.connect() as lock_connection:
            lock_name = migration_lock_name(settings.database_url.database)
            if lock_connection.scalar(text("SELECT GET_LOCK(:name, 30)"), {"name": lock_name}) != 1:
                raise ValueError("Another schema migration is running; migration stopped.")
            try:
                with engine.connect() as connection:
                    tables = set(inspect(connection).get_table_names())
                    revision = current_revision(connection)
                    adopted = False
                    if not tables:
                        previous = "empty"
                    elif revision is not None:
                        validate_schema(connection, revision)
                        previous = revision
                    else:
                        revision = legacy_revision(connection)
                        previous = "flyway_" + revision
                        adopted = True
                    if tables and (adopted or revision != HEAD):
                        if settings.profile == "container":
                            backup = os.environ.get("KUSAKARI_CANVAS_MIGRATION_BACKUP_REFERENCE")
                            if not backup or not re.fullmatch(r"arn:aws(?:-cn|-us-gov)?:rds:[a-z0-9-]+:\d{12}:snapshot:[A-Za-z0-9-]+", backup):
                                raise ValueError("Existing container DB migration requires the ARN of a verified available RDS snapshot.")
                        else:
                            backup = backup_database(settings)
                    connection.commit()
                    config = alembic_config(connection)
                    if adopted:
                        command.stamp(config, revision)
                        connection.commit()
                    command.upgrade(config, "head")
                    connection.commit()
                    validate_schema(connection, HEAD)
                    if current_revision(connection) != HEAD:
                        raise ValueError("Schema migration did not reach the expected revision.")
                    return {"database": settings.database_url.database, "previous": previous, "revision": HEAD,
                            "backup": str(backup) if backup else None}
            finally:
                lock_connection.execute(text("SELECT RELEASE_LOCK(:name)"), {"name": lock_name})
    finally:
        engine.dispose()
