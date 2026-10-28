import json
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .errors import ApiError, bad_request, not_found
from .media import MediaStore
from .models import Asset, Garden, GardenThumbnail, PlacedObject
from .plant_schemas import PlantComposition
from .schemas import (
    AssetResponse,
    BaseDimensions,
    CreateGardenRequest,
    GardenDocument,
    GardenDocumentRequest,
    GardenObject,
    GardenPhoto,
    GardenSummary,
    Vector,
)
from .validation import validate_document


def owned_garden(session: Session, owner: str, id: str, *, lock: bool = False) -> Garden:
    query = select(Garden).where(Garden.id == id, Garden.owner_id == owner)
    if lock:
        query = query.with_for_update()
    garden = session.scalar(query)
    if garden is None:
        raise not_found()
    return garden


def as_document(garden: Garden, objects: list[GardenObject], media: MediaStore | None = None) -> GardenDocument:
    photo = json.loads(garden.photo_json) if garden.photo_json else None
    if photo and media:
        photo = media.load_photo(photo)
    return GardenDocument(id=garden.id, revision=garden.revision, name=garden.name,
                          width=garden.width, depth=garden.depth, objects=objects,
                          photo=GardenPhoto.model_validate(photo) if photo else None)


def object_response(obj: PlacedObject) -> GardenObject:
    vectors = {kind: Vector(**{axis: getattr(obj, f"{kind}_{axis}") for axis in "xyz"})
               for kind in ("position", "rotation", "scale")}
    composition = PlantComposition.model_validate_json(obj.model_composition_json) if obj.model_composition_json else None
    return GardenObject(id=obj.id, assetId=obj.asset_id, productId=obj.product_id, productName=obj.product_name,
                        materialCode=obj.material_code, modelComposition=composition, **vectors)


def list_assets(session: Session) -> list[AssetResponse]:
    with session.begin():
        return [AssetResponse(id=a.id, name=a.name, category=a.category, modelUrl=a.model_url,
                              baseDimensions=BaseDimensions(width=float(a.base_width), height=float(a.base_height),
                                                            depth=float(a.base_depth)))
                for a in session.scalars(select(Asset).order_by(Asset.id))]


def require_asset(session: Session, asset_id: str) -> None:
    with session.begin():
        if session.get(Asset, asset_id) is None:
            bad_request("UNKNOWN_ASSET", "カタログに存在しないアセットです。")


def list_gardens(session: Session, owner: str) -> list[GardenSummary]:
    with session.begin():
        return [GardenSummary(id=g.id, name=g.name, width=g.width, depth=g.depth, revision=g.revision,
                              updatedAt=g.updated_at.replace(tzinfo=UTC))
                for g in session.scalars(select(Garden).where(Garden.owner_id == owner)
                                         .order_by(Garden.updated_at.desc()))]


def create_garden(session: Session, owner: str, request: CreateGardenRequest) -> GardenDocument:
    with session.begin():
        garden = Garden(id=str(uuid4()), owner_id=owner, name=request.name.strip(), width=request.width,
                        depth=request.depth, revision=0, updated_at=datetime.now(UTC).replace(tzinfo=None))
        session.add(garden)
        session.flush()
        response = as_document(garden, [])
    return response


def get_garden(session: Session, owner: str, id: str, media: MediaStore | None = None) -> GardenDocument:
    with session.begin():
        garden = owned_garden(session, owner, id)
        objects = [object_response(o) for o in session.scalars(select(PlacedObject)
                   .where(PlacedObject.garden_id == garden.id).order_by(PlacedObject.id))]
    return as_document(garden, objects, media)


def update_garden(session: Session, owner: str, id: str, document: GardenDocumentRequest,
                  media: MediaStore | None = None) -> GardenDocument:
    validate_document(document)
    if id != document.id:
        bad_request("GARDEN_ID_MISMATCH", "URLと保存データの庭IDが一致しません。")
    photo = document.photo.model_dump(mode="json") if document.photo else None
    if media and media.external:
        with session.begin():
            garden = owned_garden(session, owner, id)
            if garden.revision != document.revision:
                raise ApiError(409, "REVISION_CONFLICT", "庭が別の版で更新されています。最新データを取得してください。")
        photo = media.store_photo(photo)
    with session.begin():
        garden = owned_garden(session, owner, id, lock=True)
        if garden.revision != document.revision:
            raise ApiError(409, "REVISION_CONFLICT", "庭が別の版で更新されています。最新データを取得してください。")
        if garden.revision == 9223372036854775807:
            raise ApiError(409, "REVISION_EXHAUSTED", "庭の版番号を更新できません。")
        asset_ids = {obj.assetId for obj in document.objects}
        known = set(session.scalars(select(Asset.id).where(Asset.id.in_(asset_ids)))) if asset_ids else set()
        if known != asset_ids:
            bad_request("UNKNOWN_ASSET", "カタログに存在しないアセットが含まれています。")
        garden.name = document.name.strip()
        garden.width = document.width
        garden.depth = document.depth
        garden.revision += 1
        garden.updated_at = datetime.now(UTC).replace(tzinfo=None)
        garden.photo_json = json.dumps(photo, ensure_ascii=False, separators=(",", ":")) if photo else None
        session.execute(delete(PlacedObject).where(PlacedObject.garden_id == id))
        response_objects = []
        for obj in document.objects:
            values = {f"{kind}_{axis}": getattr(getattr(obj, kind), axis)
                      for kind in ("position", "rotation", "scale") for axis in "xyz"}
            session.add(PlacedObject(id=obj.id.lower(), garden_id=id, asset_id=obj.assetId,
                                     product_id=obj.productId, product_name=obj.productName,
                                     material_code=obj.materialCode,
                                     model_composition_json=obj.modelComposition.model_dump_json()
                                     if obj.modelComposition else None, **values))
            response_objects.append(obj.model_copy(update={"id": obj.id.lower()}))
        session.flush()
        response = GardenDocument(id=garden.id, revision=garden.revision, name=garden.name,
                                  width=garden.width, depth=garden.depth, objects=response_objects,
                                  photo=document.photo)
    return response


def delete_garden(session: Session, owner: str, id: str) -> None:
    with session.begin():
        session.delete(owned_garden(session, owner, id, lock=True))
        session.flush()


DUPLICATE_SUFFIX = "（複製）"
DUPLICATE_NAME_UNITS = 54
COPIED_OBJECT_COLUMNS = tuple(column.key for column in PlacedObject.__table__.columns
                              if column.key not in {"id", "garden_id"})


def duplicate_name(name: str) -> str:
    # 従来の画面と同じくUTF-16の54単位で切り詰めます。サロゲートペアは分割しません。
    kept, units = [], 0
    for char in name:
        size = 2 if ord(char) > 0xFFFF else 1
        if units + size > DUPLICATE_NAME_UNITS:
            break
        kept.append(char)
        units += size
    return "".join(kept) + DUPLICATE_SUFFIX


def duplicate_garden(session: Session, owner: str, id: str) -> GardenSummary:
    """写真・輪郭・実寸補正・配置を1トランザクションで複製します。生成履歴は複製しません。"""
    with session.begin():
        # 保存(PUT)と同じ行ロックで、庭と配置の組み合わせが途中の版にならないようにします。
        source = owned_garden(session, owner, id, lock=True)
        copy = Garden(id=str(uuid4()), owner_id=owner, name=duplicate_name(source.name), width=source.width,
                      depth=source.depth, revision=0, updated_at=datetime.now(UTC).replace(tzinfo=None),
                      # S3保存時はimageKeyの参照を共有します。キーは内容のハッシュで、庭の削除で消えません。
                      photo_json=source.photo_json)
        session.add(copy)
        session.flush()
        for obj in session.scalars(select(PlacedObject).where(PlacedObject.garden_id == source.id)
                                   .order_by(PlacedObject.id)):
            session.add(PlacedObject(id=str(uuid4()), garden_id=copy.id,
                                     **{key: getattr(obj, key) for key in COPIED_OBJECT_COLUMNS}))
        capture = session.get(GardenThumbnail, source.id)
        if capture is not None and capture.revision == source.revision:
            session.add(GardenThumbnail(garden_id=copy.id, revision=copy.revision,
                                        image_png=capture.image_png, image_key=capture.image_key))
        session.flush()
        return GardenSummary(id=copy.id, name=copy.name, width=copy.width, depth=copy.depth,
                             revision=copy.revision, updatedAt=copy.updated_at.replace(tzinfo=UTC))
