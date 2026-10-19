"""Check evidence opt-in and storage-failure isolation without paid generation."""

import base64
import hashlib
import json
import os
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4

from PIL import Image

from kusakari_canvas_api.ai_config import AiSettings
from kusakari_canvas_api.ai_evaluation import verify_evaluation_request
from kusakari_canvas_api.ai_evidence import save_generation_evidence
from kusakari_canvas_api.config import REPO_ROOT
from kusakari_canvas_api.errors import ApiError


def main() -> None:
    names = ("KUSAKARI_CANVAS_AI_LIVE", "KUSAKARI_CANVAS_AI_QUALITY_LIVE",
             "KUSAKARI_CANVAS_AI_EVIDENCE_DIR", "KUSAKARI_CANVAS_AI_MASKLESS",
             "KUSAKARI_CANVAS_AI_EVAL_QUALITY", "KUSAKARI_CANVAS_AI_EVAL_PLAN")
    previous = {name: os.environ.get(name) for name in names}
    with TemporaryDirectory(prefix="canvas-evidence-") as temporary:
        directory = Path(temporary)
        try:
            os.environ.pop(names[4], None)
            os.environ.pop(names[5], None)
            os.environ[names[2]] = str(directory)
            os.environ[names[3]] = "1"
            for live, quality in (("0", "0"), ("1", "0"), ("0", "1")):
                os.environ[names[0]] = live
                os.environ[names[1]] = quality
                assert AiSettings.from_profile("e2e").evidence_directory is None
                assert AiSettings.from_profile("e2e").use_mask
                assert AiSettings.from_profile("e2e").quality == "medium"
                os.environ[names[4]] = "high"
                try:
                    AiSettings.from_profile("e2e")
                except ValueError:
                    pass
                else:
                    raise AssertionError("Quality override must require both live flags")
                os.environ.pop(names[4])
            os.environ[names[0]] = "1"
            os.environ[names[1]] = "1"
            assert AiSettings.from_profile("dev").evidence_directory is None
            assert AiSettings.from_profile("dev").use_mask
            assert AiSettings.from_profile("e2e").evidence_directory == directory.resolve()
            assert not AiSettings.from_profile("e2e").use_mask
            for quality in ("medium", "high"):
                os.environ[names[4]] = quality
                assert AiSettings.from_profile("e2e").quality == quality
            for profile, value in (("dev", "high"), ("e2e", "low"), ("e2e", "")):
                os.environ[names[4]] = value
                try:
                    AiSettings.from_profile(profile)
                except ValueError:
                    pass
                else:
                    raise AssertionError("Unsupported quality override accepted")
            os.environ[names[4]] = "high"
            os.environ[names[2]] = " "
            try:
                AiSettings.from_profile("e2e")
            except ValueError:
                pass
            else:
                raise AssertionError("Quality override must require evidence storage")
            os.environ.pop(names[4])
            assert AiSettings.from_profile("e2e").evidence_directory is None

            settings = AiSettings("", "http://127.0.0.1", directory)
            with Image.open(REPO_ROOT / "e2e/fixtures/ai-quality/garden.jpg") as image:
                output = BytesIO()
                image.convert("RGBA").save(output, format="PNG")
                content = output.getvalue()
            source = "data:image/png;base64," + base64.b64encode(content).decode("ascii")
            generation_id = uuid4()
            prompt = "evidence verification\nsecond line"
            args = (generation_id, [content], content, prompt, content, source,
                    (1280, 853), (1280, 853))
            save_generation_evidence(settings, *args)
            saved = directory / str(generation_id)
            assert (saved / "provider.png").read_bytes() == content
            assert (saved / "after.png").read_bytes() == content
            original_metadata = (saved / "metadata.json").read_bytes()
            assert json.loads(original_metadata)["quality"] == "medium"
            assert json.loads(original_metadata)["promptSha256"] == hashlib.sha256(prompt.encode()).hexdigest()
            assert (saved / "prompt.txt").read_bytes() == prompt.encode()
            plan = {"model": "gpt-image-2.5-sunburst", "quality": "medium",
                    "originalSize": [1280, 853], "providerSize": [1280, 853],
                    "imageHashes": [hashlib.sha256(content).hexdigest()],
                    "maskSha256": hashlib.sha256(content).hexdigest(),
                    "promptSha256": hashlib.sha256(prompt.encode()).hexdigest()}
            plan_path = directory / "plan.json"
            plan_path.write_text(json.dumps(plan), encoding="utf-8")
            os.environ[names[2]] = str(directory)
            os.environ[names[4]] = "medium"
            os.environ[names[5]] = str(plan_path)
            assert AiSettings.from_profile("e2e").evaluation_plan == plan_path.resolve()
            os.environ[names[5]] = str(directory / "missing.json")
            try:
                AiSettings.from_profile("e2e")
            except ValueError:
                pass
            else:
                raise AssertionError("Missing evaluation plan accepted")
            os.environ[names[5]] = str(plan_path)
            os.environ.pop(names[4])
            try:
                AiSettings.from_profile("e2e")
            except ValueError:
                pass
            else:
                raise AssertionError("Evaluation plan without explicit quality accepted")
            os.environ.pop(names[5])
            guarded = AiSettings("", settings.ec_origin, directory, evaluation_plan=plan_path)
            verify_evaluation_request(guarded, [content], content, prompt, (1280, 853), (1280, 853))
            for field in ("model", "quality", "originalSize", "providerSize", "imageHashes",
                          "maskSha256", "promptSha256"):
                plan_path.write_text(json.dumps({**plan, field: None}), encoding="utf-8")
                try:
                    verify_evaluation_request(guarded, [content], content, prompt, (1280, 853), (1280, 853))
                except ApiError as error:
                    assert error.code == "AI_EVALUATION_INPUT_CHANGED"
                else:
                    raise AssertionError("Changed paid request conditions must be rejected")
            plan_path.write_text("invalid JSON", encoding="utf-8")
            try:
                verify_evaluation_request(guarded, [content], content, prompt, (1280, 853), (1280, 853))
            except ApiError as error:
                assert error.code == "AI_EVALUATION_PLAN_INVALID"
            else:
                raise AssertionError("Unreadable evaluation plan accepted")
            save_generation_evidence(settings, *args)
            assert (saved / "metadata.json").read_bytes() == original_metadata
            blocked = directory / "not-a-directory"
            blocked.write_text("occupied", encoding="utf-8")
            save_generation_evidence(AiSettings("", settings.ec_origin, blocked), *args)
            assert blocked.read_text(encoding="utf-8") == "occupied"
            maskless_id = uuid4()
            high_settings = AiSettings("", settings.ec_origin, directory, quality="high")
            save_generation_evidence(high_settings, maskless_id, [content], None, "maskless verification",
                                     content, source, (1280, 853), (1280, 853))
            assert not (directory / str(maskless_id) / "mask.png").exists()
            metadata = json.loads((directory / str(maskless_id) / "metadata.json").read_text(encoding="utf-8"))
            assert metadata["maskSent"] is False
            assert metadata["quality"] == "high"
        finally:
            for name, value in previous.items():
                if value is None:
                    os.environ.pop(name, None)
                else:
                    os.environ[name] = value
    result = {"paidRequests": 0, "evidenceRequiresE2eAndBothFlagsAndDirectory": True,
              "providerAndAfterBytesPreserved": True, "existingEvidencePreserved": True,
              "storageFailureDoesNotRaise": True, "masklessRestrictedToPaidE2e": True,
              "qualityOverrideRequiresEvaluation": True, "mediumAndHighEvidenceCorrect": True,
              "promptHashMatchesSubmittedText": True, "changedEvaluationConditionsRejected": 7,
              "unreadableEvaluationPlanRejected": True}
    path = REPO_ROOT / "artifacts/fastapi/quality-settings-evidence-checks.json"
    path.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
