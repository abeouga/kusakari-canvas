"""Opt-in live E2E only: reject inserts for one dedicated fixture garden."""

import os
import sys
from uuid import UUID

from sqlalchemy import text

from kusakari_canvas_api.config import Settings
from kusakari_canvas_api.database import create_database_engine


def main() -> None:
    if os.environ.get("KUSAKARI_CANVAS_AI_LIVE") != "1" or os.environ.get("KUSAKARI_CANVAS_HISTORY_FAULT_LIVE") != "1":
        raise ValueError("Explicit live E2E opt-in is required.")
    os.environ["KUSAKARI_CANVAS_PROFILE"] = "e2e"
    settings = Settings.from_env()
    garden_id = str(UUID(sys.argv[2]))
    trigger = "kusakari_phase4_" + UUID(garden_id).hex
    action = sys.argv[1]
    if action not in {"install", "remove"}:
        raise ValueError("Unknown fault action.")
    engine = create_database_engine(settings)
    try:
        with engine.begin() as connection:
            row = connection.execute(text("SELECT owner_id,name FROM gardens WHERE id=:id"),
                                     {"id": garden_id}).one_or_none()
            if row is None or row.owner_id != settings.owner_id or not row.name.startswith("E2E occlusion "):
                raise ValueError("Fault injection requires this run's dedicated fixture garden.")
            if action == "remove":
                connection.exec_driver_sql(f"DROP TRIGGER IF EXISTS `{trigger}`")
            else:
                connection.exec_driver_sql(
                    f"CREATE TRIGGER `{trigger}` BEFORE INSERT ON garden_image_history FOR EACH ROW "
                    f"BEGIN IF NEW.garden_id = '{garden_id}' THEN "
                    "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Intentional E2E history failure'; "
                    "END IF; END")
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
