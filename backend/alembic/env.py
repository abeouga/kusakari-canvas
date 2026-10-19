from alembic import context
from kusakari_canvas_api.history_models import HistoryEntity  # noqa: F401 - register Alembic metadata
from kusakari_canvas_api.models import Base

connection = context.config.attributes.get("connection")
if connection is None:
    raise RuntimeError("Use python -m kusakari_canvas_api migrate: schema checks and backup must precede migration.")
context.configure(connection=connection, target_metadata=Base.metadata, transaction_per_migration=True)
with context.begin_transaction():
    context.run_migrations()
