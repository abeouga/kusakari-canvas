"""Keep existing images intact and allow new images in private object storage."""
import sqlalchemy as sa
from sqlalchemy.dialects.mysql import LONGBLOB, VARCHAR

from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for table, fields in (("garden_image_history", ("before", "after")), ("garden_thumbnails", ("image",))):
        for name in fields:
            op.add_column(table, sa.Column(f"{name}_key", VARCHAR(512), nullable=True))
            op.alter_column(table, f"{name}_png", existing_type=LONGBLOB(), nullable=True)


def downgrade() -> None:
    raise RuntimeError("Restore a verified database and media backup; do not discard object references.")
