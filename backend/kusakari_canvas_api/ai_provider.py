import base64
import binascii

import httpx
from openai import APIConnectionError, APIResponseValidationError, APIStatusError, APITimeoutError, OpenAI

from .ai_config import MAX_AFTER_DATA_URL_LENGTH, MAX_AFTER_IMAGE_BYTES, MODEL, AiSettings
from .errors import ApiError


def edit_images(settings: AiSettings, images: list[bytes], mask: bytes | None, prompt: str,
                size: tuple[int, int]) -> bytes:
    settings.require_key()
    if not 1 <= len(images) <= 16:
        raise ApiError(400, "AI_IMAGE_COUNT", "主画像・参考写真の合計は16枚以内にしてください。")
    files = [(f"image-{index + 1}.png", content, "image/png") for index, content in enumerate(images)]
    mask_options = {}
    if mask is not None:
        mask_options["mask"] = ("edit-mask.png", mask, "image/png")
    try:
        with OpenAI(api_key=settings.api_key, base_url="https://api.openai.com/v1",
                    max_retries=0, timeout=180,
                    http_client=httpx.Client(timeout=180, follow_redirects=False, trust_env=False)) as client:
            response = client.images.edit(model=MODEL, quality=settings.quality, n=1, output_format="png",
                                          background="opaque", size=f"{size[0]}x{size[1]}",
                                          image=files, prompt=prompt, **mask_options)
    except APITimeoutError:
        raise ApiError(504, "AI_TIMEOUT", "AI画像生成が180秒の通信制限を超えました。再実行前に生成状況を確認してください。") from None
    except APIConnectionError:
        raise ApiError(502, "AI_CONNECTION_FAILED", "AI画像生成APIへ接続できませんでした。") from None
    except APIResponseValidationError:
        raise ApiError(502, "AI_OUTPUT_INVALID", "AI APIの応答形式が不正です。") from None
    except APIStatusError as error:
        if error.status_code == 401:
            raise ApiError(502, "AI_AUTHENTICATION_FAILED", "AI APIキーが認証されませんでした。管理者が設定を確認してください。") from None
        if error.status_code == 403:
            raise ApiError(502, "AI_ACCESS_DENIED", "AIモデルへのアクセスが許可されていません。アカウント設定を確認してください。") from None
        if error.status_code == 429:
            raise ApiError(429, "AI_RATE_LIMITED", "AI APIの利用上限に達しました。利用枠を確認し、時間を置いて再実行してください。") from None
        if error.status_code in {400, 422}:
            raise ApiError(502, "AI_PROVIDER_REJECTED", "AI APIが画像生成要求を受け付けませんでした。入力条件とモデルの利用条件を確認してください。") from None
        raise ApiError(502, "AI_PROVIDER_FAILED", "AI画像生成APIでエラーが発生しました。") from None
    if not response.data or len(response.data) != 1:
        raise ApiError(502, "AI_OUTPUT_INVALID", "AI APIから生成画像を1枚取得できませんでした。")
    encoded = getattr(response.data[0], "b64_json", None)
    if not isinstance(encoded, str) or not encoded:
        raise ApiError(502, "AI_OUTPUT_INVALID", "AI APIの生成画像データが空です。")
    if len(encoded) > MAX_AFTER_DATA_URL_LENGTH:
        raise ApiError(502, "AI_OUTPUT_TOO_LARGE", "AI APIの生成画像が20MBの出力上限を超えています。")
    try:
        content = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error):
        raise ApiError(502, "AI_OUTPUT_INVALID", "AI APIの生成画像のBase64形式が不正です。") from None
    if not content:
        raise ApiError(502, "AI_OUTPUT_INVALID", "AI APIの生成画像が空です。")
    if len(content) > MAX_AFTER_IMAGE_BYTES:
        raise ApiError(502, "AI_OUTPUT_TOO_LARGE", "AI APIの生成画像が20MBの出力上限を超えています。")
    return content
