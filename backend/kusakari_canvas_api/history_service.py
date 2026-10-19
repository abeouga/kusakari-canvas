import base64
import binascii
import hashlib
import json
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from .ai_config import MAX_AFTER_IMAGE_BYTES
from .ai_images import decode_data_url, decode_image, require_same_size
from .ai_reference_contract import reference_key, validate_reference_keys
from .ai_schemas import ReferenceSummary
from .errors import ApiError, bad_request, not_found
from .history_models import HistoryEntity
from .history_schemas import HistoryDetail, HistoryPage, HistorySaveRequest, HistorySummary
from .media import MediaStore
from .models import Asset
from .schemas import GardenDocumentRequest
from .service import owned_garden
from .thumbnails import small_png
from .validation import validate_document


def uuid_id(value: str) -> str:
    try:
        canonical = str(UUID(value))
        if canonical != value.lower():
            raise ValueError()
        return canonical
    except (ValueError, AttributeError):
        bad_request("INVALID_ID", "IDはUUID形式で指定してください。")


def as_summary(history: HistoryEntity) -> HistorySummary:
    return HistorySummary(
        id=history.id, createdAt=history.created_at.replace(tzinfo=UTC),
        width=history.width, height=history.height, model=history.model, quality=history.quality,
        generationMethod=history.generation_method,
        inputImageCount=history.input_image_count, snapshotRevision=history.snapshot_revision,
        referenceSummary=[ReferenceSummary.model_validate(item)
                          for item in json.loads(history.reference_summary_json)],
    )


def image_data_url(content: bytes) -> str:
    return "data:image/png;base64," + base64.b64encode(content).decode("ascii")


def encode_cursor(history: HistoryEntity) -> str:
    value = json.dumps([history.created_at.isoformat(timespec="microseconds"), history.id])
    return base64.urlsafe_b64encode(value.encode("ascii")).decode("ascii")


def decode_cursor(value: str) -> tuple[datetime, str]:
    try:
        if len(value) > 256:
            raise ValueError()
        raw = base64.b64decode(value, altchars=b"-_", validate=True)
        parts = json.loads(raw)
        if not isinstance(parts, list) or len(parts) != 2:
            raise ValueError()
        created_at = datetime.fromisoformat(parts[0])
        if created_at.tzinfo is not None:
            raise ValueError()
        history_id = str(UUID(parts[1]))
        if history_id != parts[1]:
            raise ValueError()
        return created_at, history_id
    except (ValueError, TypeError, AttributeError, UnicodeError, binascii.Error):
        bad_request("INVALID_HISTORY_CURSOR", "履歴のカーソルが不正です。先頭から取得してください。")


def list_history(session: Session, owner: str, garden_id: str, limit: int, cursor: str | None) -> HistoryPage:
    garden_id = uuid_id(garden_id)
    position = decode_cursor(cursor) if cursor is not None else None
    with session.begin():
        owned_garden(session, owner, garden_id)
        query = select(HistoryEntity).where(HistoryEntity.garden_id == garden_id)
        if position is not None:
            created_at, history_id = position
            query = query.where(or_(HistoryEntity.created_at < created_at, and_(
                HistoryEntity.created_at == created_at, HistoryEntity.id < history_id)))
        query = query.order_by(HistoryEntity.created_at.desc(), HistoryEntity.id.desc()).limit(limit + 1)
        rows = list(session.scalars(query))
        items = [as_summary(row) for row in rows[:limit]]
        next_cursor = encode_cursor(rows[limit - 1]) if len(rows) > limit else None
        return HistoryPage(items=items, nextCursor=next_cursor)


def owned_history(session: Session, garden_id: str, history_id: str) -> HistoryEntity:
    history = session.scalar(select(HistoryEntity).where(
        HistoryEntity.garden_id == garden_id, HistoryEntity.id == history_id))
    if history is None:
        raise not_found()
    return history


def get_history(session: Session, owner: str, garden_id: str, history_id: str,
                media: MediaStore | None = None) -> HistoryDetail:
    media = media or MediaStore()
    garden_id, history_id = uuid_id(garden_id), uuid_id(history_id)
    with session.begin():
        owned_garden(session, owner, garden_id)
        history = owned_history(session, garden_id, history_id)
        summary = as_summary(history).model_dump()
        before, after, snapshot = history.before_png, history.after_png, history.snapshot_json
        before_key, after_key = history.before_key, history.after_key
    return HistoryDetail(
        **summary, beforeDataUrl=image_data_url(media.get(before, before_key)),
        afterDataUrl=image_data_url(media.get(after, after_key)),
        document=GardenDocumentRequest.model_validate(media.load_document(snapshot)),
    )


def delete_history(session: Session, owner: str, garden_id: str, history_id: str) -> None:
    garden_id, history_id = uuid_id(garden_id), uuid_id(history_id)
    with session.begin():
        owned_garden(session, owner, garden_id, lock=True)
        session.delete(owned_history(session, garden_id, history_id))
        session.flush()


def get_history_thumbnail(session: Session, owner: str, garden_id: str, history_id: str,
                          media: MediaStore | None = None) -> bytes:
    media = media or MediaStore()
    garden_id, history_id = uuid_id(garden_id), uuid_id(history_id)
    with session.begin():
        owned_garden(session, owner, garden_id)
        history = owned_history(session, garden_id, history_id)
        content, key = history.after_png, history.after_key
    # Only the selected After is read; original PNGs and snapshots remain unchanged.
    return small_png(decode_image(media.get(content, key), max_bytes=MAX_AFTER_IMAGE_BYTES))


def history_fingerprint(request: HistorySaveRequest, before_png: bytes, after_png: bytes) -> str:
    metadata = request.model_dump(mode="json", exclude={"beforeDataUrl", "afterDataUrl"})
    if request.generationMethod == "masked_composite_v1":
        # 0003 fingerprints predate this field. Keep their original representation.
        metadata.pop("generationMethod")
    canonical_json = json.dumps(metadata, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(canonical_json.encode("utf-8"))
    for image in (before_png, after_png):
        digest.update(len(image).to_bytes(8, "big"))
        digest.update(image)
    return digest.hexdigest()


def validate_history(request: HistorySaveRequest, garden_id: str) -> tuple[bytes, bytes, str, str, int, int]:
    document = request.document
    if uuid_id(document.id) != garden_id:
        bad_request("GARDEN_ID_MISMATCH", "URLと撮影時の庭IDが一致しません。")
    validate_document(document)
    if document.photo is None:
        bad_request("AI_PHOTO_REQUIRED", "画像履歴には撮影時の庭写真が必要です。")
    before = decode_data_url(request.beforeDataUrl, png_only=True, opaque=True)
    after = decode_data_url(request.afterDataUrl, png_only=True, opaque=True, max_bytes=MAX_AFTER_IMAGE_BYTES)
    if request.generationMethod != "full_frame_v3":
        require_same_size(after, before)
    if before.size != (document.photo.imageWidth, document.photo.imageHeight):
        bad_request("AI_IMAGE_DIMENSION_MISMATCH", "履歴画像と撮影時の庭写真の寸法が一致しません。")
    asset_ids = [reference_key(item.assetId, item.productId) for item in request.referenceSummary]
    if len(asset_ids) != len(set(asset_ids)):
        bad_request("AI_DUPLICATE_REFERENCE", "同じ配置商品の参考画像を重複して指定できません。")
    if request.inputImageCount < 1 + len(asset_ids):
        bad_request("AI_IMAGE_COUNT", "入力画像数がBeforeと参照商品の合計より少なくなっています。")
    # Preserve the exact PNG bytes. Validation above establishes the strict image format.
    before_png = base64.b64decode(request.beforeDataUrl.partition(",")[2], validate=True)
    after_png = base64.b64decode(request.afterDataUrl.partition(",")[2], validate=True)
    snapshot_json = document.model_dump_json()
    fingerprint = history_fingerprint(request, before_png, after_png)
    return before_png, after_png, snapshot_json, fingerprint, after.width, after.height


def save_history(session: Session, owner: str, garden_id: str, request: HistorySaveRequest,
                 media: MediaStore | None = None) -> HistorySummary:
    garden_id = uuid_id(garden_id)
    before, after, snapshot, fingerprint, width, height = validate_history(request, garden_id)
    before_key = after_key = None
    if media and media.external:
        with session.begin():
            owned_garden(session, owner, garden_id)
            existing = session.get(HistoryEntity, str(request.id))
            if existing is not None and existing.garden_id == garden_id:
                if existing.generation_method != request.generationMethod or existing.payload_sha256 != fingerprint:
                    raise ApiError(409, "HISTORY_ID_CONFLICT", "同じ履歴IDで異なる画像や撮影情報を保存できません。")
                return as_summary(existing)
        before, before_key = media.put(before)
        after, after_key = media.put(after)
        snapshot = media.store_document(snapshot)
    with session.begin():
        # Serialize saves with deletion of this garden; no external I/O occurs in this transaction.
        owned_garden(session, owner, garden_id, lock=True)
        existing = session.scalar(select(HistoryEntity).where(
            HistoryEntity.garden_id == garden_id, HistoryEntity.id == str(request.id)))
        if existing is not None:
            if existing.generation_method != request.generationMethod or existing.payload_sha256 != fingerprint:
                raise ApiError(409, "HISTORY_ID_CONFLICT", "同じ履歴IDで異なる画像や撮影情報を保存できません。")
            return as_summary(existing)
        asset_ids = {item.assetId for item in request.document.objects}
        assets = list(session.scalars(select(Asset).where(Asset.id.in_(asset_ids))))
        if {asset.id for asset in assets} != asset_ids:
            bad_request("UNKNOWN_ASSET", "撮影時の庭に未知のアセットが含まれています。")
        plant_ids = {asset.id for asset in assets if asset.category in {"tree", "shrub"}}
        validate_reference_keys(request.document, plant_ids, request.referenceSummary)
        history = HistoryEntity(
            id=str(request.id), garden_id=garden_id, created_at=datetime.now(UTC).replace(tzinfo=None),
            width=width, height=height, model=request.model, quality=request.quality,
            generation_method=request.generationMethod,
            input_image_count=request.inputImageCount, snapshot_revision=request.document.revision,
            reference_summary_json=json.dumps([item.model_dump() for item in request.referenceSummary]),
            snapshot_json=snapshot, before_png=before, after_png=after,
            before_key=before_key, after_key=after_key, payload_sha256=fingerprint,
        )
        session.add(history)
        session.flush()
        return as_summary(history)
