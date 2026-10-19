import os
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlparse

from .errors import ApiError

MODEL = "gpt-image-2.5-sunburst"
QUALITY = "medium"
SUPPORTED_QUALITIES = ("medium", "high")
DEFAULT_PROMPT_VERSION = "scene_layout_v1"
SUPPORTED_PROMPT_VERSIONS = (DEFAULT_PROMPT_VERSION, "scene_layout_v2")
DEFAULT_MASK_MARGIN_PX = 8
SUPPORTED_MASK_MARGINS = (0, DEFAULT_MASK_MARGIN_PX)
GENERATION_METHOD = "full_frame_v3"
MAX_BODY_BYTES = 48_000_000
MAX_IMAGE_BYTES = 8_000_000
MAX_DATA_URL_LENGTH = 10_666_700
MAX_AFTER_IMAGE_BYTES = 20_000_000
MAX_AFTER_DATA_URL_LENGTH = 26_666_700
MAX_EDGE = 2048
MAX_PIXELS = 3_686_400


@dataclass(frozen=True)
class AiSettings:
    api_key: str = field(repr=False)
    ec_origin: str
    evidence_directory: Path | None = None
    use_mask: bool = True
    quality: str = QUALITY
    evaluation_plan: Path | None = None
    prompt_version: str = DEFAULT_PROMPT_VERSION
    mask_margin_px: int = DEFAULT_MASK_MARGIN_PX
    image_origin: str | None = None

    @property
    def catalog_image_origin(self) -> str:
        return self.image_origin or self.ec_origin

    @classmethod
    def from_profile(cls, profile: str) -> "AiSettings":
        key_name = "OPENAI_API_KEY"
        ec_name = "KUSAKARI_CANVAS_EC_URL"
        if profile == "e2e":
            key_name = "KUSAKARI_CANVAS_E2E_OPENAI_API_KEY"
            ec_name = "KUSAKARI_CANVAS_E2E_EC_URL"
        key = os.environ.get(key_name, "").strip()
        origin = os.environ.get(ec_name, "http://127.0.0.1:5186/").strip()
        parsed = urlparse(origin)
        if (parsed.scheme not in {"http", "https"} or not parsed.hostname
                or parsed.username or parsed.password or parsed.query or parsed.fragment
                or parsed.path not in {"", "/"}):
            raise ValueError(f"{ec_name} must be an HTTP(S) origin without credentials, query or path.")
        evidence_directory = None
        use_mask = True
        if (profile == "e2e" and os.environ.get("KUSAKARI_CANVAS_AI_LIVE") == "1"
                and os.environ.get("KUSAKARI_CANVAS_AI_QUALITY_LIVE") == "1"):
            directory = os.environ.get("KUSAKARI_CANVAS_AI_EVIDENCE_DIR", "").strip()
            if directory:
                evidence_directory = Path(directory).resolve()
            use_mask = os.environ.get("KUSAKARI_CANVAS_AI_MASKLESS") != "1"
        quality = QUALITY
        override = os.environ.get("KUSAKARI_CANVAS_AI_EVAL_QUALITY")
        if override is not None:
            if evidence_directory is None:
                raise ValueError("KUSAKARI_CANVAS_AI_EVAL_QUALITY requires E2E live quality evaluation and evidence storage.")
            quality = override.strip()
            if quality not in SUPPORTED_QUALITIES:
                raise ValueError("KUSAKARI_CANVAS_AI_EVAL_QUALITY must be medium or high.")
        evaluation_plan = None
        plan_path = os.environ.get("KUSAKARI_CANVAS_AI_EVAL_PLAN")
        if plan_path is not None:
            if override is None or evidence_directory is None or not plan_path.strip():
                raise ValueError("KUSAKARI_CANVAS_AI_EVAL_PLAN requires explicit E2E evaluation quality and evidence storage.")
            evaluation_plan = Path(plan_path).resolve()
            if not evaluation_plan.is_file():
                raise ValueError("KUSAKARI_CANVAS_AI_EVAL_PLAN must name an existing evaluation plan.")
        prompt_version = DEFAULT_PROMPT_VERSION
        prompt_override = os.environ.get("KUSAKARI_CANVAS_AI_EVAL_PROMPT_VERSION")
        if prompt_override is not None:
            if evaluation_plan is None or evidence_directory is None or override is None:
                raise ValueError("Prompt override requires E2E evaluation, explicit quality, plan and evidence storage.")
            prompt_version = prompt_override.strip()
            if prompt_version not in SUPPORTED_PROMPT_VERSIONS:
                raise ValueError("Unsupported evaluation prompt version.")
            if prompt_version == "scene_layout_v2" and not use_mask:
                raise ValueError("scene_layout_v2 evaluation requires the frozen mask.")
        mask_margin_px = DEFAULT_MASK_MARGIN_PX
        margin_override = os.environ.get("KUSAKARI_CANVAS_AI_EVAL_MASK_MARGIN_PX")
        if margin_override is not None:
            if evaluation_plan is None or evidence_directory is None or override is None or not use_mask:
                raise ValueError("Mask margin override requires masked E2E evaluation, quality, plan and evidence.")
            if margin_override not in {"0", "8"}:
                raise ValueError("Evaluation mask margin must be 0 or 8 pixels.")
            mask_margin_px = int(margin_override)
        image_name = "KUSAKARI_CANVAS_E2E_EC_IMAGE_ORIGIN" if profile == "e2e" else "KUSAKARI_CANVAS_EC_IMAGE_ORIGIN"
        image_origin = os.environ.get(image_name, origin).strip().rstrip("/")
        image_address = urlparse(image_origin)
        if (image_address.scheme not in {"http", "https"} or not image_address.hostname
                or image_address.username or image_address.password or image_address.path
                or image_address.query or image_address.fragment):
            raise ValueError(f"{image_name} must be an HTTP(S) origin without credentials, query or path.")
        return cls(key, origin.rstrip("/"), evidence_directory, use_mask,
                   quality=quality, evaluation_plan=evaluation_plan, prompt_version=prompt_version,
                   mask_margin_px=mask_margin_px, image_origin=image_origin)

    def require_key(self) -> None:
        if not self.api_key:
            raise ApiError(503, "AI_NOT_CONFIGURED", "AI画像生成のAPIキーが設定されていません。")
