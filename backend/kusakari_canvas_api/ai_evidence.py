"""Opt-in evidence for public-fixture E2E evaluation; never enabled in dev."""

import base64
import hashlib
import json
import logging
from datetime import UTC, datetime
from uuid import UUID

from .ai_config import GENERATION_METHOD, MODEL, AiSettings


def save_generation_evidence(settings: AiSettings, generation_id: UUID, images: list[bytes],
                             mask: bytes | None, prompt: str, provider: bytes, after_data_url: str,
                             original_size: tuple[int, int], provider_size: tuple[int, int]) -> None:
    if settings.evidence_directory is None:
        return
    directory = settings.evidence_directory / str(generation_id)
    after = base64.b64decode(after_data_url.split(",", 1)[1], validate=True)
    inputs = []
    for index, content in enumerate(images):
        role = "reference"
        if index == 0:
            role = "main"
        inputs.append({"index": index + 1, "role": role, "bytes": len(content),
                       "sha256": hashlib.sha256(content).hexdigest()})
    metadata = {"generationId": str(generation_id), "recordedAt": datetime.now(UTC).isoformat(),
                "generationMethod": GENERATION_METHOD, "model": MODEL, "quality": settings.quality,
                "promptSha256": hashlib.sha256(prompt.encode("utf-8")).hexdigest(),
                "promptVersion": settings.prompt_version,
                "maskMarginPx": settings.mask_margin_px,
                "originalSize": original_size, "providerSize": provider_size, "maskSent": mask is not None,
                "inputs": inputs, "providerSha256": hashlib.sha256(provider).hexdigest(),
                "afterSha256": hashlib.sha256(after).hexdigest()}
    try:
        # A repeated ID must never overwrite evidence from an earlier generation.
        directory.mkdir(parents=True, exist_ok=False)
        (directory / "provider.png").write_bytes(provider)
        (directory / "after.png").write_bytes(after)
        if mask is not None:
            (directory / "mask.png").write_bytes(mask)
        (directory / "prompt.txt").write_text(prompt, encoding="utf-8", newline="\n")
        (directory / "metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    except OSError as error:
        # Evaluation checks completeness. Evidence storage must not discard a valid result.
        logging.getLogger(__name__).error("AI evidence save failed: %s", type(error).__name__)
