import sqlalchemy as sa
from sqlalchemy.dialects.mysql import VARCHAR

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("garden_image_history", sa.Column(
        "generation_method", VARCHAR(32), nullable=False,
        server_default=sa.text("'masked_composite_v1'"),
    ))
    op.alter_column("garden_image_history", "generation_method", existing_type=VARCHAR(32),
                    existing_nullable=False, server_default=None)


def downgrade() -> None:
    raise RuntimeError("Deleting generation method metadata is disabled; restore the verified database backup.")
