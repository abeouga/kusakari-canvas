"""Verify silhouette masks and pre-send configuration guards without provider requests."""
import hashlib
import io
import json
import os
from dataclasses import replace
from pathlib import Path
from tempfile import TemporaryDirectory

from PIL import Image

from kusakari_canvas_api.ai_config import AiSettings
from kusakari_canvas_api.ai_evaluation import verify_evaluation_request
from kusakari_canvas_api.ai_images import editable_mask, provider_mask
from kusakari_canvas_api.config import REPO_ROOT
from kusakari_canvas_api.errors import ApiError
from verification.ai_quality_review import require_visual_review_plan
from verification.run_ai_quality import BASE, frozen_plan


def verify_pixels() -> None:
    coverage = Image.new("RGBA", (32, 24), (0, 0, 0, 255))
    coverage.putpixel((5, 7), (255, 0, 0, 255))
    coverage.putpixel((6, 8), (4, 0, 0, 255))
    coverage.putpixel((7, 9), (255, 255, 0, 255))
    coverage.putpixel((8, 10), (2, 0, 0, 255))
    editable = editable_mask(coverage, 0)
    with Image.open(io.BytesIO(provider_mask(editable, (32, 32)))) as provider:
        for y in range(32):
            for x in range(32):
                expected = (x, y) in {(5, 7), (6, 8)}
                assert (provider.getpixel((x, y))[3] == 0) == expected
    for value in (-1, 1, 16, True, None):
        try:
            editable_mask(coverage, value)
        except ApiError as error:
            assert error.code == "AI_MASK_MARGIN_INVALID"
        else:
            raise AssertionError("Invalid margin accepted")


def verify_settings(directory: Path) -> None:
    prefix = "KUSAKARI_CANVAS_AI_"
    names = [prefix + suffix for suffix in ("LIVE", "QUALITY_LIVE", "EVIDENCE_DIR", "MASKLESS",
             "EVAL_QUALITY", "EVAL_PLAN", "EVAL_MASK_MARGIN_PX", "EVAL_PROMPT_VERSION")]
    previous = {name: os.environ.get(name) for name in names}
    try:
        for name in names:
            os.environ.pop(name, None)
        assert AiSettings.from_profile("dev").mask_margin_px == 8
        path = directory / "plan.json"
        plan = frozen_plan("single", "scene_layout_v2", 0)
        plan["quality"] = "medium"
        path.write_text(json.dumps(plan), encoding="utf-8")
        valid = dict(zip(names, ("1", "1", str(directory), "0", "medium", str(path), "0", "scene_layout_v2"), strict=True))
        os.environ.update(valid)
        assert AiSettings.from_profile("e2e").mask_margin_px == 0
        for name in (names[0], names[1], names[2], names[4], names[5]):
            os.environ.pop(name)
            try:
                AiSettings.from_profile("e2e")
            except ValueError:
                pass
            else:
                raise AssertionError("Incomplete margin evaluation settings accepted")
            os.environ.update(valid)
        for profile, margin in (("dev", "0"), ("e2e", ""), ("e2e", "-1"), ("e2e", "16")):
            os.environ[names[6]] = margin
            try:
                AiSettings.from_profile(profile)
            except ValueError:
                pass
            else:
                raise AssertionError("Invalid margin override accepted")
        os.environ.update(valid)
        os.environ[names[3]] = "1"
        try:
            AiSettings.from_profile("e2e")
        except ValueError:
            pass
        else:
            raise AssertionError("Margin override without mask accepted")
        os.environ.update(valid)
        settings = AiSettings.from_profile("e2e")
        content, prompt = b"explicit preflight fixture", "explicit preflight fixture"
        digest = hashlib.sha256(content).hexdigest()
        request_plan = {"model": plan["model"], "quality": "medium", "promptVersion": "scene_layout_v2",
                        "originalSize": [32, 24], "providerSize": [32, 32], "imageHashes": [digest],
                        "maskSha256": digest, "promptSha256": hashlib.sha256(prompt.encode()).hexdigest(),
                        "maskMarginPx": 0}
        path.write_text(json.dumps(request_plan), encoding="utf-8")
        verify_evaluation_request(settings, [content], content, prompt, (32, 24), (32, 32))
        try:
            verify_evaluation_request(replace(settings, mask_margin_px=8), [content], content, prompt, (32, 24), (32, 32))
        except ApiError as error:
            assert error.code == "AI_EVALUATION_INPUT_CHANGED"
        else:
            raise AssertionError("Wrong actual mask margin accepted")
    finally:
        for name, value in previous.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value


def main() -> None:
    verify_pixels()
    records = []
    review_path = BASE / "mask-margin-review-plan.json"
    review = json.loads(review_path.read_text(encoding="utf-8"))
    for case in ("single", "overlap"):
        original = frozen_plan(case, "scene_layout_v2", 8)
        candidate = frozen_plan(case, "scene_layout_v2", 0)
        for field in ("imageHashes", "promptSha256", "layout", "model", "originalSize", "providerSize"):
            assert original[field] == candidate[field]
        assert original["maskSha256"] != candidate["maskSha256"]
        candidate["quality"] = "medium"
        assert require_visual_review_plan(str(review_path), candidate, review["cases"][case]["run"])
        records.append({"case": case, "onlyMaskChanged": True})
    with TemporaryDirectory(prefix="canvas-mask-margin-") as temporary:
        verify_settings(Path(temporary))
    result = {"paidRequests": 0, "zeroMarginPixelsExact": True, "furnitureAndPaddingProtected": True,
              "invalidSettingsRejected": True, "actualMarginMismatchRejected": True, "cases": records}
    (REPO_ROOT / "artifacts/fastapi/mask-margin-checks.json").write_text(json.dumps(result, indent=2))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
