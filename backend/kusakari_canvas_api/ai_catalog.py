import json
import re
import time
from urllib.parse import urlparse

import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .ai_config import MAX_IMAGE_BYTES, AiSettings
from .ai_images import decode_data_url, decode_image, opaque_reference, png_bytes
from .ai_schemas import AiCandidate, AiStore, ReferenceRequest, ReferenceSummary
from .errors import ApiError, bad_request

MATERIAL_CODES = {"tree_oak": "plant.oak", "shrub_boxwood": "plant.boxwood"}


class CatalogProduct(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True)
    id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=250)
    imageUrl: str = Field(min_length=1, max_length=2000)
    active: bool = True
    hasPlantModel: bool = False


def material_code(asset_id: str) -> str:
    code = MATERIAL_CODES.get(asset_id)
    if code is None:
        bad_request("AI_UNSUPPORTED_ASSET", "この植物アセットの商品照合には対応していません。")
    return code


def raster_url(settings: AiSettings, image_url: str) -> str | None:
    parsed = urlparse(image_url)
    if parsed.query or parsed.fragment or parsed.params or parsed.username or parsed.password:
        return None
    if parsed.scheme or parsed.netloc:
        if f"{parsed.scheme}://{parsed.netloc}" != settings.catalog_image_origin:
            return None
    path = parsed.path
    if ".." in path or not re.fullmatch(r"/images/(?:[A-Za-z0-9_-]+/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(?i:png|jpe?g|webp)", path):
        return None
    return settings.catalog_image_origin + path


def read_response(response: httpx.Response, limit: int) -> bytes:
    response.raise_for_status()
    content = bytearray()
    deadline = time.monotonic() + 20
    for chunk in response.iter_bytes():
        content.extend(chunk)
        if len(content) > limit:
            raise ApiError(502, "AI_CATALOG_RESPONSE_TOO_LARGE", "ECの応答容量が上限を超えました。")
        if time.monotonic() > deadline:
            raise ApiError(504, "AI_CATALOG_TIMEOUT", "ECからの応答が制限時間を超えました。")
    return bytes(content)


def quote_products(settings: AiSettings, store_id: int, asset_id: str) -> list[CatalogProduct]:
    code = material_code(asset_id)
    body = {"storeId": store_id, "items": [{"materialCode": code, "quantity": 1, "unit": "piece"}]}
    try:
        with httpx.Client(timeout=10, follow_redirects=False, trust_env=False) as client:
            with client.stream("POST", settings.ec_origin + "/api/materials/quote", json=body) as response:
                content = read_response(response, 1_000_000)
        payload = json.loads(content)
        if not isinstance(payload, list) or len(payload) != 1:
            raise ValueError()
        match = payload[0]
        if match["materialCode"] != code or not isinstance(match["candidates"], list):
            raise ValueError()
        products = []
        ids = set()
        for item in match["candidates"]:
            product = CatalogProduct.model_validate(item["product"])
            if product.id in ids:
                raise ValueError()
            ids.add(product.id)
            products.append(product)
        return products
    except httpx.TimeoutException:
        raise ApiError(504, "AI_CATALOG_TIMEOUT", "ECの商品候補照合がタイムアウトしました。") from None
    except httpx.HTTPStatusError as error:
        if error.response.status_code in {400, 404}:
            bad_request("AI_CATALOG_STORE_INVALID", "指定店舗の商品候補を取得できません。店舗を確認してください。")
        raise ApiError(502, "AI_CATALOG_UNAVAILABLE", "ECの商品候補照合に失敗しました。") from None
    except httpx.RequestError:
        raise ApiError(502, "AI_CATALOG_UNAVAILABLE", "ECへ接続できません。ECの起動と接続先を確認してください。") from None
    except (ValueError, KeyError, TypeError, ValidationError):
        raise ApiError(502, "AI_CATALOG_INVALID", "ECの商品候補応答の形式が不正です。") from None


def candidates(settings: AiSettings, store_id: int, asset_id: str) -> list[AiCandidate]:
    products = quote_products(settings, store_id, asset_id)
    return [AiCandidate(assetId=asset_id, productId=product.id, productName=product.name,
                        imageUrl=candidate_image_url(settings, product.imageUrl),
                        requiresUpload=raster_url(settings, product.imageUrl) is None)
            for product in products]


def linked_products(settings: AiSettings, product_ids: list[str]) -> dict[str, CatalogProduct]:
    if not product_ids or len(product_ids) > 200 or len(set(product_ids)) != len(product_ids) \
            or any(not re.fullmatch(r"[A-Za-z0-9_-]{1,40}", value) for value in product_ids):
        bad_request("AI_REFERENCE_PRODUCT_INVALID", "参照する商品のIDが不正または重複しています。")
    try:
        with httpx.Client(timeout=10, follow_redirects=False, trust_env=False) as client:
            with client.stream("POST", settings.ec_origin + "/api/products/references",
                               json={"productIds": product_ids}) as response:
                content = read_response(response, 1_000_000)
        payload = json.loads(content)
        if not isinstance(payload, list) or len(payload) != len(product_ids):
            raise ValueError()
        rows = [CatalogProduct.model_validate(item) for item in payload]
        result = {item.id: item for item in rows}
        if set(result) != set(product_ids):
            raise ValueError()
        if any(not item.hasPlantModel for item in rows):
            bad_request("AI_REFERENCE_PRODUCT_MISMATCH", "配置に紐づく商品の植物モデルが登録されていません。")
        return result
    except httpx.TimeoutException:
        raise ApiError(504, "AI_CATALOG_TIMEOUT", "配置商品の自動取得がタイムアウトしました。") from None
    except httpx.HTTPStatusError as error:
        if error.response.status_code == 404:
            bad_request("AI_REFERENCE_PRODUCT_MISSING", "配置に紐づく商品が見つかりません。商品一覧から配置し直してください。")
        raise ApiError(502, "AI_CATALOG_UNAVAILABLE", "配置商品の登録情報を取得できませんでした。") from None
    except httpx.RequestError:
        raise ApiError(502, "AI_CATALOG_UNAVAILABLE", "ECへ接続できません。接続状態を確認してください。") from None
    except (ValueError, KeyError, TypeError, ValidationError):
        raise ApiError(502, "AI_CATALOG_INVALID", "配置商品の登録情報の形式が不正です。") from None


def product_references(settings: AiSettings, product_ids: list[str]) -> list[AiCandidate]:
    products = linked_products(settings, product_ids)
    return [AiCandidate(assetId="plant_modular", productId=item.id, productName=item.name,
                        imageUrl=candidate_image_url(settings, item.imageUrl), active=item.active,
                        requiresUpload=raster_url(settings, item.imageUrl) is None)
            for item in (products[product_id] for product_id in product_ids)]


def candidate_image_url(settings: AiSettings, image_url: str) -> str:
    if image_url.startswith("/images/") and not image_url.startswith("//"):
        return settings.catalog_image_origin + image_url
    return image_url


def stores(settings: AiSettings) -> list[AiStore]:
    try:
        with httpx.Client(timeout=10, follow_redirects=False, trust_env=False) as client:
            with client.stream("GET", settings.ec_origin + "/api/stores") as response:
                content = read_response(response, 1_000_000)
        payload = json.loads(content)
        if not isinstance(payload, list) or len(payload) > 1000:
            raise ValueError()
        result = []
        ids = set()
        for row in payload:
            if not isinstance(row, dict):
                raise ValueError()
            store = AiStore.model_validate({"id": row.get("id"), "name": row.get("name"),
                                            "address": row.get("address")}, strict=True)
            if store.id in ids:
                raise ValueError()
            ids.add(store.id)
            result.append(store)
        return result
    except httpx.TimeoutException:
        raise ApiError(504, "AI_CATALOG_TIMEOUT", "ECの店舗一覧取得がタイムアウトしました。") from None
    except (httpx.HTTPStatusError, httpx.RequestError):
        raise ApiError(502, "AI_CATALOG_UNAVAILABLE", "ECの店舗一覧を取得できません。") from None
    except (ValueError, KeyError, TypeError, ValidationError):
        raise ApiError(502, "AI_CATALOG_INVALID", "ECの店舗一覧応答の形式が不正です。") from None


def catalog_image(settings: AiSettings, product: CatalogProduct) -> bytes:
    url = raster_url(settings, product.imageUrl)
    if url is None:
        bad_request("AI_REFERENCE_UNSUPPORTED", "登録画像はSVGまたは未対応のURLです。PNG・JPEG・WebPの参考写真を追加してください。")
    extension = url.rsplit(".", 1)[1].lower()
    formats = {"png": "PNG", "jpg": "JPEG", "jpeg": "JPEG", "webp": "WEBP"}
    try:
        with httpx.Client(timeout=10, follow_redirects=False, trust_env=False) as client:
            with client.stream("GET", url) as response:
                content = read_response(response, MAX_IMAGE_BYTES)
        image = decode_image(content, expected_format=formats[extension])
        return png_bytes(opaque_reference(image))
    except httpx.TimeoutException:
        raise ApiError(504, "AI_REFERENCE_TIMEOUT", "登録参考画像の取得がタイムアウトしました。") from None
    except (httpx.HTTPStatusError, httpx.RequestError):
        raise ApiError(502, "AI_REFERENCE_UNAVAILABLE", "ECに登録された参考画像を取得できません。") from None
    except ApiError as error:
        if error.status == 400:
            raise ApiError(502, "AI_REFERENCE_INVALID", "EC登録画像の形式・寸法・容量が不正です。") from None
        raise


def resolve_reference(settings: AiSettings, store_id: int,
                      reference: ReferenceRequest,
                      products: dict[str, CatalogProduct] | None = None) -> tuple[bytes, ReferenceSummary]:
    if reference.assetId == "plant_modular":
        product = (products if products is not None else linked_products(settings, [reference.productId])).get(reference.productId)
    else:
        product = next((item for item in quote_products(settings, store_id, reference.assetId)
                        if item.id == reference.productId), None)
    if product is None:
        bad_request("AI_REFERENCE_PRODUCT_MISMATCH", "選択商品が指定店舗・植物アセットの商品候補に含まれていません。")
    source = "catalog"
    if reference.photoDataUrl is not None:
        # Uploaded photos are user references, never represented as EC-registered photographs.
        source = "uploaded"
        content = png_bytes(opaque_reference(decode_data_url(reference.photoDataUrl)))
    else:
        content = catalog_image(settings, product)
    summary = ReferenceSummary(assetId=reference.assetId, productId=product.id,
                               productName=product.name, source=source)
    return content, summary
