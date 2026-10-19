import logging
from contextlib import contextmanager
from threading import Lock
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from .ai_catalog import MATERIAL_CODES, linked_products, resolve_reference
from .ai_config import GENERATION_METHOD, MODEL, AiSettings
from .ai_evaluation import verify_evaluation_request
from .ai_evidence import save_generation_evidence
from .ai_frame import generation_size, resize_layout, resize_scene_image, scene_mask
from .ai_images import (
    decode_data_url,
    editable_mask,
    finalize_generated_image,
    png_bytes,
    require_same_size,
)
from .ai_layout import layout_manifest
from .ai_prompt import generation_prompt
from .ai_provider import edit_images
from .ai_reference_contract import validate_reference_keys
from .ai_schemas import AiImageRequest, AiImageResponse
from .errors import ApiError, bad_request
from .history_models import HistoryEntity
from .history_schemas import HistorySaveRequest
from .history_service import save_history, uuid_id
from .models import Asset
from .service import owned_garden
from .validation import validate_document

_generation_guard = Lock()
_active_owners: set[str] = set()


@contextmanager
def generation_lock(owner: str):
    # Local demo only. A multi-process deployment needs a shared lock mechanism.
    with _generation_guard:
        if owner in _active_owners:
            raise ApiError(409, "AI_GENERATION_IN_PROGRESS", "この利用者のAI画像生成は実行中です。完了後に再実行してください。")
        _active_owners.add(owner)
    try:
        yield
    finally:
        with _generation_guard:
            _active_owners.discard(owner)


def validate_snapshot(session: Session, owner: str, garden_id: str, request: AiImageRequest) -> list[dict]:
    document = request.document
    if document.id != garden_id:
        bad_request("GARDEN_ID_MISMATCH", "URLと撮影時の庭IDが一致しません。")
    if document.photo is None:
        bad_request("AI_PHOTO_REQUIRED", "AI画像生成には庭の写真を指定してください。")
    validate_document(document)
    with session.begin():
        garden = owned_garden(session, owner, garden_id)
        if garden.revision != document.revision:
            raise ApiError(409, "REVISION_CONFLICT", "庭が別の版で更新されています。撮影し直してください。")
        asset_ids = {item.assetId for item in document.objects}
        assets = list(session.scalars(select(Asset).where(Asset.id.in_(asset_ids))))
        if {asset.id for asset in assets} != asset_ids:
            bad_request("UNKNOWN_ASSET", "カタログに存在しないアセットが含まれています。")
        plant_ids = {asset.id for asset in assets if asset.category in {"tree", "shrub"}}
        categories = {asset.id: asset.category for asset in assets}
    # The read transaction is closed before any EC/OpenAI network operation.
    if not plant_ids:
        bad_request("AI_NO_PLANTS", "AI画像生成には商品に紐づく植物を配置してください。")
    if not plant_ids.issubset({*MATERIAL_CODES, "plant_modular"}):
        bad_request("AI_UNSUPPORTED_ASSET", "商品照合に対応していない植物アセットが含まれています。")
    validate_reference_keys(document, plant_ids, request.references)
    if 1 + len(request.references) > 16:
        bad_request("AI_IMAGE_COUNT", "主画像・参考写真の合計は16枚以内にしてください。")
    return layout_manifest(request, categories)


def generate_image(session: Session, settings: AiSettings, owner: str, garden_id: str,
                   request: AiImageRequest) -> AiImageResponse:
    garden_id = uuid_id(garden_id)
    history_id = request.generationId or uuid4()
    with generation_lock(owner):
        layout = validate_snapshot(session, owner, garden_id, request)
        settings.require_key()
        with session.begin():
            if session.scalar(select(HistoryEntity.id).where(HistoryEntity.id == str(history_id))) is not None:
                raise ApiError(409, "HISTORY_ALREADY_EXISTS", "この生成IDは保存済みです。履歴から結果を取得してください。")
        before = decode_data_url(request.beforeDataUrl, png_only=True, opaque=True)
        coverage = decode_data_url(request.coverageDataUrl, png_only=True, opaque=True)
        require_same_size(coverage, before)
        photo = request.document.photo
        if before.size != (photo.imageWidth, photo.imageHeight):
            bad_request("AI_IMAGE_DIMENSION_MISMATCH", "撮影画像と庭の写真の寸法が一致しません。")
        editable = editable_mask(coverage, settings.mask_margin_px)
        size = generation_size(before.size)
        images = [png_bytes(resize_scene_image(before, size))]
        # Validate user photos before network traffic, even if another reference fails later.
        for reference in request.references:
            if reference.photoDataUrl is not None:
                decode_data_url(reference.photoDataUrl)
        summaries = []
        product_ids = [item.productId for item in request.references if item.assetId == "plant_modular"]
        products = linked_products(settings, product_ids) if product_ids else None
        for reference in request.references:
            content, summary = resolve_reference(settings, request.storeId, reference, products)
            images.append(content)
            summaries.append(summary)
        mask = None
        if settings.use_mask:
            mask = scene_mask(editable, size)
        prompt = generation_prompt(request, summaries, resize_layout(layout, before.size, size),
                                   use_mask=settings.use_mask, prompt_version=settings.prompt_version,
                                   canvas_size=size)
        verify_evaluation_request(settings, images, mask, prompt, before.size, size)
        result = edit_images(settings, images, mask, prompt, size)
        response = AiImageResponse(dataUrl=finalize_generated_image(result, before.size, size),
                                   width=size[0], height=size[1], model=MODEL, quality=settings.quality,
                                   generationMethod=GENERATION_METHOD,
                                   inputImageCount=len(images), referenceSummary=summaries,
                                   historyId=str(history_id), historySaved=False)
        save_generation_evidence(settings, history_id, images, mask, prompt, result,
                                 response.dataUrl, before.size, size)
        try:
            save_history(session, owner, garden_id, HistorySaveRequest(
                id=history_id, document=request.document, beforeDataUrl=request.beforeDataUrl,
                afterDataUrl=response.dataUrl, model=response.model, quality=response.quality,
                generationMethod=response.generationMethod,
                inputImageCount=len(images), referenceSummary=summaries,
            ))
            response.historySaved = True
        except Exception as error:
            # External generation has succeeded. Preserve its output even when local persistence fails.
            session.rollback()
            logging.getLogger(__name__).error("AI history save failed: %s", type(error).__name__)
            if isinstance(error, ApiError):
                response.historyError = "画像は生成されましたが履歴を保存できませんでした。" + error.message
            else:
                response.historyError = "画像は生成されましたが履歴の保存に失敗しました。再生成せず履歴の再保存を実行してください。"
        return response
