import sqlalchemy as sa
from sqlalchemy.dialects.mysql import BIGINT, CHAR, DATETIME, INTEGER, LONGBLOB, LONGTEXT, VARCHAR

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "garden_image_history",
        sa.Column("id", CHAR(36), primary_key=True, nullable=False),
        sa.Column("garden_id", CHAR(36), nullable=False),
        sa.Column("created_at", DATETIME(fsp=6), nullable=False),
        sa.Column("width", INTEGER, nullable=False),
        sa.Column("height", INTEGER, nullable=False),
        sa.Column("model", VARCHAR(100), nullable=False),
        sa.Column("quality", VARCHAR(30), nullable=False),
        sa.Column("input_image_count", INTEGER, nullable=False),
        sa.Column("reference_summary_json", LONGTEXT, nullable=False),
        sa.Column("snapshot_revision", BIGINT, nullable=False),
        sa.Column("snapshot_json", LONGTEXT, nullable=False),
        sa.Column("before_png", LONGBLOB, nullable=False),
        sa.Column("after_png", LONGBLOB, nullable=False),
        sa.Column("payload_sha256", CHAR(64), nullable=False),
        sa.ForeignKeyConstraint(["garden_id"], ["gardens.id"],
                                name="fk_image_history_garden", ondelete="CASCADE"),
        mysql_engine="InnoDB",
    )
    op.create_index("idx_image_history_garden_created", "garden_image_history", ["garden_id", "created_at", "id"])


def downgrade() -> None:
    raise RuntimeError("Deleting saved image history is disabled; restore the verified database backup.")
