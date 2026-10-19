"""Verify frozen text and pre-send rejection without mocking a paid provider response."""
import base64
import hashlib
import json
import os
from dataclasses import replace
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4

from PIL import Image

from kusakari_canvas_api.ai_config import AiSettings
from kusakari_canvas_api.ai_evaluation import verify_evaluation_request
from kusakari_canvas_api.ai_evidence import save_generation_evidence
from kusakari_canvas_api.ai_images import png_bytes
from kusakari_canvas_api.config import REPO_ROOT
from kusakari_canvas_api.errors import ApiError
from verification.ai_quality_review import require_visual_review_plan
from verification.run_ai_quality import BASE, frozen_plan, require_measurement_ready


def rejected_settings(profile: str) -> None:
    try:
        AiSettings.from_profile(profile)
    except ValueError:
        return
    raise AssertionError("Invalid prompt evaluation settings accepted")


def rejected_request(settings, content, prompt, code="AI_EVALUATION_INPUT_CHANGED") -> None:
    try:
        verify_evaluation_request(settings, [content], content, prompt, (1280, 853), (1280, 853))
    except ApiError as error:
        assert error.code == code
        return
    raise AssertionError("Changed prompt evaluation request accepted")


def verify_frozen_text() -> list[dict]:
    records = []
    manifest = json.loads((BASE / "prompt-revision-design-01/design-manifest.json").read_text())
    for record in manifest["records"]:
        old = frozen_plan(record["case"])
        candidate = frozen_plan(record["case"], "scene_layout_v2")
        assert old["promptSha256"] == record["controlPromptSha256"]
        assert candidate["promptSha256"] == record["promptSha256"]
        for field in ("imageHashes", "maskSha256", "layout", "model", "originalSize", "providerSize"):
            assert old[field] == candidate[field]
        records.append({"case": record["case"], "v1MatchesFrozen": True, "v2MatchesFrozen": True,
                        "nonPromptConditionsMatch": True})
    return records


def verify_settings_and_evidence(directory: Path) -> None:
    prefix = "KUSAKARI_CANVAS_AI_"
    names = [prefix + suffix for suffix in ("LIVE", "QUALITY_LIVE", "EVIDENCE_DIR", "MASKLESS",
             "EVAL_QUALITY", "EVAL_PLAN", "EVAL_PROMPT_VERSION")]
    previous = {name: os.environ.get(name) for name in names}
    try:
        for name in names:
            os.environ.pop(name, None)
        assert AiSettings.from_profile("dev").prompt_version == "scene_layout_v1"
        os.environ[names[6]] = "scene_layout_v2"
        rejected_settings("dev")
        rejected_settings("e2e")
        plan_path = directory / "plan.json"
        plan_path.write_text("{}", encoding="utf-8")
        valid = dict(zip(names, ("1", "1", str(directory), "0", "medium", str(plan_path), "scene_layout_v2"), strict=True))
        os.environ.update(valid)
        for version in ("scene_layout_v1", "scene_layout_v2"):
            os.environ[names[6]] = version
            assert AiSettings.from_profile("e2e").prompt_version == version
        os.environ.update(valid)
        rejected_settings("dev")
        for name in (names[0], names[1], names[2], names[4], names[5]):
            os.environ.pop(name)
            rejected_settings("e2e")
            os.environ.update(valid)
        for value in ("", "unknown"):
            os.environ[names[6]] = value
            rejected_settings("e2e")
        os.environ.update(valid)
        os.environ[names[3]] = "1"
        rejected_settings("e2e")
        os.environ.update(valid)
        with Image.open(REPO_ROOT / "e2e/fixtures/ai-quality/garden.jpg") as image:
            content = png_bytes(image.convert("RGBA"))
        prompt = "fixture only\nnot an API generation"
        digest = hashlib.sha256(content).hexdigest()
        plan = {"model": "gpt-image-2.5-sunburst", "quality": "medium", "originalSize": [1280, 853],
                "providerSize": [1280, 853], "imageHashes": [digest], "maskSha256": digest,
                "promptSha256": hashlib.sha256(prompt.encode()).hexdigest()}
        settings = AiSettings.from_profile("e2e")
        for version in ("scene_layout_v1", "scene_layout_v2"):
            selected = replace(settings, prompt_version=version)
            plan_path.write_text(json.dumps({**plan, "promptVersion": version}), encoding="utf-8")
            verify_evaluation_request(selected, [content], content, prompt, (1280, 853), (1280, 853))
            rejected_request(selected, content, prompt + " changed")
            other = "scene_layout_v1" if version == "scene_layout_v2" else "scene_layout_v2"
            rejected_request(replace(selected, prompt_version=other), content, prompt)
            source = "data:image/png;base64," + base64.b64encode(content).decode()
            identifier = uuid4()
            save_generation_evidence(selected, identifier, [content], content, prompt, content, source,
                                     (1280, 853), (1280, 853))
            metadata = json.loads((directory / str(identifier) / "metadata.json").read_text())
            assert metadata["promptVersion"] == version
            assert metadata["promptSha256"] == hashlib.sha256(prompt.encode()).hexdigest()
        plan_path.write_text(json.dumps(plan), encoding="utf-8")
        verify_evaluation_request(replace(settings, prompt_version="scene_layout_v1"), [content], content,
                                  prompt, (1280, 853), (1280, 853))
        rejected_request(settings, content, prompt)
        plan_path.write_text("[]", encoding="utf-8")
        rejected_request(settings, content, prompt, "AI_EVALUATION_PLAN_INVALID")
    finally:
        for name, value in previous.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value


def main() -> None:
    frozen = verify_frozen_text()
    with TemporaryDirectory(prefix="canvas-prompt-check-") as temporary:
        directory = Path(temporary)
        verify_settings_and_evidence(directory)
        try:
            require_measurement_ready(None, "single")
        except ValueError:
            pass
        else:
            raise AssertionError("Missing measurement report accepted")
        path = directory / "measurement.json"
        report = {"baseline": "layout-revision-03", "case": "single", "ready": True,
                  "sizeMeasurementReady": True, "backgroundMeasurementReady": True,
                  "beforeSha256": hashlib.sha256((BASE / "layout-revision-03/single/before.png").read_bytes()).hexdigest(),
                  "criteriaSha256": hashlib.sha256((BASE / "full-frame-phase4-inputs/evaluation-plan.json").read_bytes()).hexdigest()}
        path.write_text(json.dumps(report))
        assert require_measurement_ready(path, "single")["measurementReportSha256"]
        for field in report:
            path.write_text(json.dumps({**report, field: None}))
            try:
                require_measurement_ready(path, "single")
            except ValueError:
                pass
            else:
                raise AssertionError("Incomplete measurement report accepted")
        practical = BASE / "prompt-practical-review-plan.json"
        if practical.is_file():
            report = json.loads(practical.read_text(encoding="utf-8"))
            for case in ("single", "overlap"):
                plan = {**frozen_plan(case, "scene_layout_v2"), "quality": "medium"}
                run = report["cases"][case]["run"]
                assert require_visual_review_plan(str(practical), plan, run)["reviewMode"] == "practical_v1"
                for field in ("model", "quality", "promptVersion", "imageHashes", "maskSha256", "promptSha256"):
                    try:
                        require_visual_review_plan(str(practical), {**plan, field: None}, run)
                    except ValueError:
                        pass
                    else:
                        raise AssertionError("Changed practical review condition accepted")
                try:
                    require_visual_review_plan(str(practical), plan, run + "-extra")
                except ValueError:
                    pass
                else:
                    raise AssertionError("Unregistered extra run accepted")
    result = {"paidRequests": 0, "frozenPrompts": frozen, "settingsAndEvidenceVersionsMatch": True,
              "invalidOverridesRejected": True, "v1LegacyPlanSupported": True, "v2LegacyPlanRejected": True,
              "changedPromptAndVersionRejected": True, "measurementGateVerified": True}
    result["practicalReviewGateVerified"] = practical.is_file()
    filename = "prompt-implementation-checks.json"
    if practical.is_file():
        filename = "prompt-practical-checks.json"
    (REPO_ROOT / "artifacts/fastapi" / filename).write_text(json.dumps(result, indent=2))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
