"""Reject changed evaluation conditions before sending a paid provider request."""

import hashlib
import json

from .ai_config import DEFAULT_MASK_MARGIN_PX, DEFAULT_PROMPT_VERSION, MODEL, AiSettings
from .errors import bad_request


def verify_evaluation_request(settings: AiSettings, images: list[bytes], mask: bytes | None,
                              prompt: str, original_size: tuple[int, int], provider_size: tuple[int, int]) -> None:
    if settings.evaluation_plan is None:
        return
    try:
        expected = json.loads(settings.evaluation_plan.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        bad_request("AI_EVALUATION_PLAN_INVALID", "評価計画を読み取れません。生成は送信していません。")
    if not isinstance(expected, dict):
        bad_request("AI_EVALUATION_PLAN_INVALID", "評価計画の形式が不正です。生成は送信していません。")
    expected_version = expected.get("promptVersion", DEFAULT_PROMPT_VERSION)
    if expected_version != settings.prompt_version:
        bad_request("AI_EVALUATION_INPUT_CHANGED", "生成指示の版が評価計画と異なります。生成は送信していません。")
    actual = {"model": MODEL, "quality": settings.quality,
              "originalSize": list(original_size), "providerSize": list(provider_size),
              "imageHashes": [hashlib.sha256(content).hexdigest() for content in images],
              "maskSha256": hashlib.sha256(mask).hexdigest() if mask is not None else None,
              "promptSha256": hashlib.sha256(prompt.encode("utf-8")).hexdigest()}
    if "maskMarginPx" in expected or settings.mask_margin_px != DEFAULT_MASK_MARGIN_PX:
        actual["maskMarginPx"] = settings.mask_margin_px
    if any(expected.get(name) != value for name, value in actual.items()):
        bad_request("AI_EVALUATION_INPUT_CHANGED", "入力・指示・実行条件が評価計画と異なります。生成は送信していません。")
