"""Persist a small scene thumbnail independently from the garden document."""
import sqlalchemy as sa
from sqlalchemy.dialects.mysql import BIGINT, CHAR, LONGBLOB

from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table("garden_thumbnails",
                    sa.Column("garden_id", CHAR(36), primary_key=True),
                    sa.Column("revision", BIGINT(), nullable=False),
                    sa.Column("image_png", LONGBLOB(), nullable=False),
                    sa.ForeignKeyConstraint(["garden_id"], ["gardens.id"],
                                            name="fk_thumbnail_garden", ondelete="CASCADE"),
                    mysql_engine="InnoDB")


def downgrade() -> None:
    raise RuntimeError("Restore a verified backup instead of deleting saved thumbnails.")
