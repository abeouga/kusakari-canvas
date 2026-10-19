from datetime import datetime

from sqlalchemy import ForeignKey, Index
from sqlalchemy.dialects.mysql import BIGINT, CHAR, DATETIME, INTEGER, LONGBLOB, LONGTEXT, VARCHAR
from sqlalchemy.orm import Mapped, mapped_column

from .models import Base


class HistoryEntity(Base):
    __tablename__ = "garden_image_history"
    __table_args__ = (
        Index("idx_image_history_garden_created", "garden_id", "created_at", "id"),
        {"mysql_engine": "InnoDB"},
    )

    id: Mapped[str] = mapped_column(CHAR(36), primary_key=True)
    garden_id: Mapped[str] = mapped_column(CHAR(36), ForeignKey(
        "gardens.id", name="fk_image_history_garden", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6))
    width: Mapped[int] = mapped_column(INTEGER)
    height: Mapped[int] = mapped_column(INTEGER)
    model: Mapped[str] = mapped_column(VARCHAR(100))
    quality: Mapped[str] = mapped_column(VARCHAR(30))
    generation_method: Mapped[str] = mapped_column(VARCHAR(32))
    input_image_count: Mapped[int] = mapped_column(INTEGER)
    reference_summary_json: Mapped[str] = mapped_column(LONGTEXT)
    snapshot_revision: Mapped[int] = mapped_column(BIGINT)
    snapshot_json: Mapped[str] = mapped_column(LONGTEXT, deferred=True)
    before_png: Mapped[bytes | None] = mapped_column(LONGBLOB, deferred=True)
    after_png: Mapped[bytes | None] = mapped_column(LONGBLOB, deferred=True)
    before_key: Mapped[str | None] = mapped_column(VARCHAR(512))
    after_key: Mapped[str | None] = mapped_column(VARCHAR(512))
    payload_sha256: Mapped[str] = mapped_column(CHAR(64))
