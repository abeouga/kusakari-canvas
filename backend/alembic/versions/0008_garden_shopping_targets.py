"""Store the per-product required quantity a member sets in the garden shopping list."""
import sqlalchemy as sa
from sqlalchemy.dialects.mysql import LONGTEXT

from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Nullable: existing gardens keep their meaning (required quantity follows placements).
    op.add_column("gardens", sa.Column("shopping_targets_json", LONGTEXT(), nullable=True))


def downgrade() -> None:
    raise RuntimeError("Restore a verified backup instead of discarding saved required quantities.")
