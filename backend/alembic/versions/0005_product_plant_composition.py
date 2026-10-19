import sqlalchemy as sa
from sqlalchemy.dialects.mysql import LONGTEXT, VARCHAR

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for name, kind in (("product_id", VARCHAR(40)), ("product_name", VARCHAR(120)),
                       ("material_code", VARCHAR(80)), ("model_composition_json", LONGTEXT())):
        op.add_column("placed_objects", sa.Column(name, kind, nullable=True))
    op.execute(sa.text("""
        INSERT INTO assets (id, name, category, model_url, base_width, base_height, base_depth)
        VALUES ('plant_modular', '植物（商品モデル）', 'tree',
                '/models/plant-parts/v1/stem.glb', 1, 1, 1)
    """))


def downgrade() -> None:
    raise RuntimeError("Deleting product model snapshots is disabled; restore the verified database backup.")
