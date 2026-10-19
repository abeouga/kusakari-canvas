"""Prefer generated images, then a saved scene capture, then the current placement plan."""
import io
from typing import Annotated

from fastapi import APIRouter, Depends, Response
from PIL import Image, ImageDraw
from pydantic import Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .ai_config import MAX_AFTER_IMAGE_BYTES
from .ai_images import decode_data_url, decode_image
from .errors import ApiError
from .history_models import HistoryEntity
from .media import MediaStore
from .models import GardenThumbnail, PlacedObject
from .schemas import ApiModel
from .service import owned_garden


def thumbnail_version(history_id: str | None, revision: int, captured_revision: int | None) -> str:
    if history_id:
        return "generated-" + history_id
    if captured_revision == revision:
        return f"scene-{revision}"
    return f"layout-{revision}"


def small_png(image: Image.Image) -> bytes:
    image.thumbnail((640, 400), Image.Resampling.LANCZOS)
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def placement_plan(session: Session, garden) -> bytes:
    image = Image.new("RGB", (640, 400), "#eef1e7")
    draw = ImageDraw.Draw(image)
    scale = min(500 / garden.width, 270 / garden.depth)
    width, depth = garden.width * scale, garden.depth * scale
    left, top = (640 - width) / 2, (400 - depth) / 2
    draw.rounded_rectangle((left, top, left + width, top + depth), radius=8,
                           fill="#dce5d0", outline="#a2b593", width=2)
    rows = session.execute(select(PlacedObject.position_x, PlacedObject.position_z,
                                  PlacedObject.asset_id).where(PlacedObject.garden_id == garden.id))
    for x, z, asset in rows:
        cx, cy = 320 + x * scale, 200 + z * scale
        radius = max(5, min(18, scale * 0.3))
        color = "#537e52" if asset not in {"bench_wood", "brick_paver"} else "#a2815c"
        draw.ellipse((cx-radius, cy-radius, cx+radius, cy+radius), fill=color, outline="#f7faf1", width=2)
    return small_png(image)


def read_thumbnail(session: Session, owner: str, garden_id: str,
                   media: MediaStore | None = None) -> tuple[bytes, str]:
    media = media or MediaStore()
    with session.begin():
        garden = owned_garden(session, owner, garden_id)
        generated = session.execute(select(HistoryEntity.after_png, HistoryEntity.after_key)
                                   .where(HistoryEntity.garden_id == garden.id)
                                   .order_by(HistoryEntity.created_at.desc(), HistoryEntity.id.desc()).limit(1)).first()
        if generated is not None:
            content, key = generated
            source = "generated"
        else:
            capture = session.get(GardenThumbnail, garden.id)
            if not capture or capture.revision != garden.revision:
                return placement_plan(session, garden), "layout"
            content, key, source = capture.image_png, capture.image_key, "scene"
    content = media.get(content, key)
    return (small_png(decode_image(content, max_bytes=MAX_AFTER_IMAGE_BYTES)) if source == "generated" else content), source


class ThumbnailRequest(ApiModel):
    revision: int = Field(ge=0, strict=True)
    dataUrl: str = Field(max_length=450000, repr=False)


def thumbnail_router(owner: str, get_session, media: MediaStore | None = None) -> APIRouter:
    media = media or MediaStore()
    router = APIRouter(prefix="/api/gardens/{id}/thumbnail", tags=["thumbnails"])
    Db = Annotated[Session, Depends(get_session)]

    @router.get("")
    def get(id: str, db: Db):
        content, source = read_thumbnail(db, owner, id, media)
        return Response(content, media_type="image/png", headers={
            "Cache-Control": "private, no-cache", "X-Thumbnail-Source": source})

    @router.post("", status_code=204)
    def save(id: str, request: ThumbnailRequest, db: Db):
        image = decode_data_url(request.dataUrl, png_only=True, max_bytes=330000)
        if image.width > 640 or image.height > 400:
            raise ApiError(400, "THUMBNAIL_SIZE", "サムネイルは640×400px以内で指定してください。")
        with db.begin():
            garden = owned_garden(db, owner, id)
            if garden.revision != request.revision:
                raise ApiError(409, "THUMBNAIL_STALE", "庭の配置が更新されています。")
        content, key = media.put(small_png(image))
        with db.begin():
            garden = owned_garden(db, owner, id, lock=True)
            if garden.revision != request.revision:
                raise ApiError(409, "THUMBNAIL_STALE", "庭の配置が更新されています。")
            item = db.get(GardenThumbnail, garden.id)
            if item is None:
                item = GardenThumbnail(garden_id=garden.id)
                db.add(item)
            item.revision, item.image_png, item.image_key = garden.revision, content, key
        return Response(status_code=204)

    return router
