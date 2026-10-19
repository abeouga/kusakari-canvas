"""Lightweight shopping projections of the owner's saved garden placements."""
from datetime import UTC, datetime

from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session, defer

from .history_models import HistoryEntity
from .models import Asset, Garden, GardenThumbnail, PlacedObject
from .service import owned_garden
from .thumbnails import thumbnail_version

MATERIAL_CODES = {
    "tree_oak": "plant.oak", "shrub_boxwood": "plant.boxwood",
    "brick_paver": "garden.brick", "bench_wood": "garden.bench",
}


class ShoppingRow(BaseModel):
    key: str
    name: str
    productId: str | None
    materialCode: str
    quantity: int
    unit: str = "piece"


class ShoppingList(BaseModel):
    gardenId: str
    name: str
    revision: int
    updatedAt: datetime
    items: list[ShoppingRow]


class ShoppingSummary(BaseModel):
    gardenId: str
    name: str
    revision: int
    updatedAt: datetime
    thumbnailVersion: str
    productCount: int
    itemCount: int


def summaries(session: Session, owner: str) -> list[ShoppingSummary]:
    with session.begin():
        latest_image = (select(HistoryEntity.id).where(HistoryEntity.garden_id == Garden.id)
                        .order_by(HistoryEntity.created_at.desc(), HistoryEntity.id.desc())
                        .limit(1).correlate(Garden).scalar_subquery())
        captured_revision = (select(GardenThumbnail.revision).where(GardenThumbnail.garden_id == Garden.id)
                             .correlate(Garden).scalar_subquery())
        query = (select(Garden, latest_image, captured_revision, func.count(func.distinct(func.coalesce(
            PlacedObject.product_id, PlacedObject.asset_id))), func.count(PlacedObject.id))
            .outerjoin(PlacedObject, PlacedObject.garden_id == Garden.id)
            .where(Garden.owner_id == owner).group_by(Garden.id).options(defer(Garden.photo_json))
            .order_by(Garden.updated_at.desc(), Garden.id))
        return [ShoppingSummary(gardenId=g.id, name=g.name, revision=g.revision,
                                updatedAt=g.updated_at.replace(tzinfo=UTC),
                                thumbnailVersion=thumbnail_version(history, g.revision, captured),
                                productCount=kinds, itemCount=count)
                for g, history, captured, kinds, count in session.execute(query)]


def detail(session: Session, owner: str, garden_id: str) -> ShoppingList:
    with session.begin():
        garden = owned_garden(session, owner, garden_id)
        query = (select(PlacedObject.asset_id, PlacedObject.product_id,
                        PlacedObject.product_name, PlacedObject.material_code, Asset.name)
                 .join(Asset, Asset.id == PlacedObject.asset_id)
                 .where(PlacedObject.garden_id == garden.id).order_by(PlacedObject.id))
        rows: dict[str, ShoppingRow] = {}
        for asset_id, product_id, product_name, code, asset_name in session.execute(query):
            key = f"product:{product_id}" if product_id else f"asset:{asset_id}"
            if key not in rows:
                rows[key] = ShoppingRow(key=key, name=product_name or asset_name,
                                        productId=product_id,
                                        materialCode=code or MATERIAL_CODES.get(asset_id, ""), quantity=0)
            rows[key].quantity += 1
        return ShoppingList(gardenId=garden.id, name=garden.name, revision=garden.revision,
                            updatedAt=garden.updated_at.replace(tzinfo=UTC),
                            items=sorted(rows.values(), key=lambda row: (row.name, row.key)))
