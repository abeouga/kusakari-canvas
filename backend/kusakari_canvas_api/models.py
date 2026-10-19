from datetime import datetime
from decimal import Decimal

from sqlalchemy import ForeignKey, Index
from sqlalchemy.dialects.mysql import BIGINT, CHAR, DECIMAL, DOUBLE, LONGBLOB, LONGTEXT, TIMESTAMP, VARCHAR
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Asset(Base):
    __tablename__ = "assets"
    __table_args__ = {"mysql_engine": "InnoDB"}
    id: Mapped[str] = mapped_column(VARCHAR(64), primary_key=True)
    name: Mapped[str] = mapped_column(VARCHAR(120))
    category: Mapped[str] = mapped_column(VARCHAR(40))
    model_url: Mapped[str] = mapped_column(VARCHAR(255))
    base_width: Mapped[Decimal] = mapped_column(DECIMAL(8, 3))
    base_height: Mapped[Decimal] = mapped_column(DECIMAL(8, 3))
    base_depth: Mapped[Decimal] = mapped_column(DECIMAL(8, 3))


class Garden(Base):
    __tablename__ = "gardens"
    __table_args__ = (Index("idx_gardens_owner_updated", "owner_id", "updated_at"),
                      {"mysql_engine": "InnoDB"})
    id: Mapped[str] = mapped_column(CHAR(36), primary_key=True)
    owner_id: Mapped[str] = mapped_column(VARCHAR(128))
    name: Mapped[str] = mapped_column(VARCHAR(120))
    width: Mapped[float] = mapped_column(DOUBLE(asdecimal=False))
    depth: Mapped[float] = mapped_column(DOUBLE(asdecimal=False))
    revision: Mapped[int] = mapped_column(BIGINT)
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(fsp=6))
    photo_json: Mapped[str | None] = mapped_column(LONGTEXT)


class PlacedObject(Base):
    __tablename__ = "placed_objects"
    __table_args__ = (Index("idx_placed_objects_garden", "garden_id"), {"mysql_engine": "InnoDB"})
    id: Mapped[str] = mapped_column(CHAR(36), primary_key=True)
    garden_id: Mapped[str] = mapped_column(CHAR(36), ForeignKey(
        "gardens.id", name="fk_placed_objects_garden", ondelete="CASCADE"))
    asset_id: Mapped[str] = mapped_column(VARCHAR(64), ForeignKey("assets.id", name="fk_placed_objects_asset"))
    product_id: Mapped[str | None] = mapped_column(VARCHAR(40))
    product_name: Mapped[str | None] = mapped_column(VARCHAR(120))
    material_code: Mapped[str | None] = mapped_column(VARCHAR(80))
    model_composition_json: Mapped[str | None] = mapped_column(LONGTEXT)
    position_x: Mapped[float] = mapped_column(DOUBLE(asdecimal=False))
    position_y: Mapped[float] = mapped_column(DOUBLE(asdecimal=False))
    position_z: Mapped[float] = mapped_column(DOUBLE(asdecimal=False))
    rotation_x: Mapped[float] = mapped_column(DOUBLE(asdecimal=False))
    rotation_y: Mapped[float] = mapped_column(DOUBLE(asdecimal=False))
    rotation_z: Mapped[float] = mapped_column(DOUBLE(asdecimal=False))
    scale_x: Mapped[float] = mapped_column(DOUBLE(asdecimal=False))
    scale_y: Mapped[float] = mapped_column(DOUBLE(asdecimal=False))
    scale_z: Mapped[float] = mapped_column(DOUBLE(asdecimal=False))


class GardenThumbnail(Base):
    __tablename__ = "garden_thumbnails"
    __table_args__ = {"mysql_engine": "InnoDB"}
    garden_id: Mapped[str] = mapped_column(CHAR(36), ForeignKey(
        "gardens.id", name="fk_thumbnail_garden", ondelete="CASCADE"), primary_key=True)
    revision: Mapped[int] = mapped_column(BIGINT)
    image_png: Mapped[bytes | None] = mapped_column(LONGBLOB, deferred=True)
    image_key: Mapped[str | None] = mapped_column(VARCHAR(512))
