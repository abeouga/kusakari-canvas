"""Prepare one fixed-input evaluation. Paid execution requires an explicit --live."""

import argparse
import base64
import hashlib
import json
import os
import re
import shutil
import subprocess
from pathlib import Path

from kusakari_canvas_api.ai_config import (
    DEFAULT_MASK_MARGIN_PX,
    DEFAULT_PROMPT_VERSION,
    MODEL,
    SUPPORTED_MASK_MARGINS,
    SUPPORTED_PROMPT_VERSIONS,
    SUPPORTED_QUALITIES,
)
from kusakari_canvas_api.ai_images import (
    decode_data_url,
    editable_mask,
    opaque_reference,
    pad_image,
    padded_size,
    png_bytes,
    provider_mask,
)
from kusakari_canvas_api.ai_layout import layout_manifest
from kusakari_canvas_api.ai_prompt import generation_prompt
from kusakari_canvas_api.ai_schemas import AiImageRequest, ReferenceSummary
from kusakari_canvas_api.config import REPO_ROOT, load_local_settings
from verification.ai_quality_review import require_visual_review_plan

BASE = REPO_ROOT / "artifacts/e2e/ai-quality"
BASELINE = "layout-revision-03"


def file_data_url(path) -> str:
    mime = "image/png"
    if path.suffix.lower() in {".jpg", ".jpeg"}:
        mime = "image/jpeg"
    elif path.suffix.lower() == ".webp":
        mime = "image/webp"
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode("ascii")


def frozen_plan(case: str, prompt_version: str = DEFAULT_PROMPT_VERSION,
                mask_margin_px: int = DEFAULT_MASK_MARGIN_PX) -> dict:
    if prompt_version not in SUPPORTED_PROMPT_VERSIONS:
        raise ValueError("Unsupported prompt version")
    if type(mask_margin_px) is not int or mask_margin_px not in SUPPORTED_MASK_MARGINS:
        raise ValueError("Unsupported mask margin")
    folder = BASE / BASELINE / case
    saved = json.loads((folder / "request.json").read_text(encoding="utf-8"))
    snapshot = json.loads((folder / "snapshot.json").read_text(encoding="utf-8"))
    references = []
    for item in saved["inputOrder"]:
        if item["kind"] == "uploaded-reference":
            references.append({"assetId": item["assetId"], "productId": item["productId"],
                               "photoDataUrl": file_data_url(folder / item["file"])})
    request = AiImageRequest(document=snapshot, storeId=saved["storeId"], layout=saved["layout"],
                             beforeDataUrl=file_data_url(folder / "before.png"),
                             coverageDataUrl=file_data_url(folder / "coverage.png"),
                             references=references)
    evidence = BASE / (BASELINE + "-provider") / saved["generationId"]
    metadata = json.loads((evidence / "metadata.json").read_text(encoding="utf-8"))
    if metadata["model"] != MODEL or metadata["maskSent"] is not True:
        raise ValueError("The fixed model and mask conditions no longer match.")
    before = decode_data_url(request.beforeDataUrl)
    size = padded_size(before.size)
    images = [png_bytes(pad_image(before, size))]
    for reference in request.references:
        image = decode_data_url(reference.photoDataUrl)
        prepared = opaque_reference(image)
        images.append(png_bytes(prepared))
    hashes = [hashlib.sha256(content).hexdigest() for content in images]
    retained_inputs = [item for item in metadata["inputs"] if item["role"] != "supplement"]
    if hashes != [item["sha256"] for item in retained_inputs]:
        raise ValueError("Prepared image hashes differ from the frozen baseline.")
    mask = provider_mask(editable_mask(decode_data_url(request.coverageDataUrl)), size)
    if mask != (evidence / "mask.png").read_bytes() or list(size) != metadata["providerSize"]:
        raise ValueError("Prepared mask or dimensions differ from the frozen baseline.")
    metrics = json.loads((folder / "metrics.json").read_text(encoding="utf-8"))
    summaries = [ReferenceSummary.model_validate(item) for item in metrics["referenceSummary"]]
    categories = {"tree_oak": "tree", "shrub_boxwood": "shrub", "bench_wood": "furniture"}
    layout = layout_manifest(request, categories)
    prompt = generation_prompt(request, summaries, layout)
    plan = {"baseline": BASELINE, "case": case, "model": MODEL, "originalSize": before.size,
            "providerSize": size, "imageHashes": hashes, "maskSha256": hashlib.sha256(mask).hexdigest(),
            "promptSha256": hashlib.sha256(prompt.encode("utf-8")).hexdigest(),
            "layout": saved["layout"], "generationRequestsAllowed": 1, "promptVersion": prompt_version}
    if prompt_version == "scene_layout_v2":
        prompt = generation_prompt(request, summaries, layout, prompt_version=prompt_version)
        plan["promptSha256"] = hashlib.sha256(prompt.encode("utf-8")).hexdigest()
        manifest = json.loads((BASE / "prompt-revision-design-01/design-manifest.json").read_text(encoding="utf-8"))
        record = next(item for item in manifest["records"] if item["case"] == case)
        for field in ("model", "providerSize", "originalSize", "imageHashes", "maskSha256",
                      "promptSha256", "layout", "promptVersion"):
            actual = plan[field]
            if isinstance(actual, tuple):
                actual = list(actual)
            if actual != record[field]:
                raise ValueError(f"Candidate differs from the frozen design: {field}")
    if mask_margin_px != DEFAULT_MASK_MARGIN_PX:
        mask = provider_mask(editable_mask(decode_data_url(request.coverageDataUrl), mask_margin_px), size)
        plan["maskSha256"] = hashlib.sha256(mask).hexdigest()
    plan["maskMarginPx"] = mask_margin_px
    return plan


def require_measurement_ready(path, case: str) -> dict:
    if path is None:
        raise ValueError("Prompt comparison requires a saved measurement-readiness report before paid execution.")
    report_path = Path(path).resolve()
    report = json.loads(report_path.read_text(encoding="utf-8"))
    if (not isinstance(report, dict) or report.get("baseline") != BASELINE or report.get("case") != case
            or report.get("ready") is not True or report.get("sizeMeasurementReady") is not True
            or report.get("backgroundMeasurementReady") is not True):
        raise ValueError("Measurement readiness has not been established. No generation was submitted.")
    before_path = BASE / BASELINE / case / "before.png"
    criteria_path = BASE / "full-frame-phase4-inputs/evaluation-plan.json"
    if (report.get("beforeSha256") != hashlib.sha256(before_path.read_bytes()).hexdigest()
            or report.get("criteriaSha256") != hashlib.sha256(criteria_path.read_bytes()).hexdigest()):
        raise ValueError("Measurement report refers to different inputs or criteria. No generation was submitted.")
    return {"measurementReport": str(report_path),
            "measurementReportSha256": hashlib.sha256(report_path.read_bytes()).hexdigest()}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--case", choices=("single", "overlap"), required=True)
    parser.add_argument("--quality", choices=SUPPORTED_QUALITIES, required=True)
    parser.add_argument("--run", required=True)
    parser.add_argument("--prompt-version", choices=SUPPORTED_PROMPT_VERSIONS)
    parser.add_argument("--measurement-report")
    parser.add_argument("--visual-review-plan")
    parser.add_argument("--mask-margin-px", type=int, choices=SUPPORTED_MASK_MARGINS, default=DEFAULT_MASK_MARGIN_PX)
    parser.add_argument("--live", action="store_true")
    args = parser.parse_args()
    if args.visual_review_plan and (args.measurement_report or args.prompt_version is None):
        parser.error("Practical review requires an explicit prompt version and its own review plan.")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,100}", args.run):
        parser.error("Use a unique run name of up to 101 letters, digits, periods, hyphens or underscores.")
    output = BASE / args.run
    evidence = BASE / (args.run + "-provider")
    plan_path = BASE / (args.run + "-plan.json")
    if any(path.exists() for path in (output, evidence, plan_path)):
        parser.error("This run name is already used. Never overwrite or automatically repeat it.")
    prompt_version = args.prompt_version or DEFAULT_PROMPT_VERSION
    if args.mask_margin_px != DEFAULT_MASK_MARGIN_PX and not args.visual_review_plan:
        parser.error("Mask-margin evaluation requires a registered visual review plan.")
    plan = frozen_plan(args.case, prompt_version, args.mask_margin_px)
    plan.update({"run": args.run, "quality": args.quality, "live": args.live})
    if args.live:
        if args.prompt_version is not None:
            if args.quality != "medium":
                parser.error("The frozen prompt comparison requires medium for both conditions.")
            try:
                if args.visual_review_plan:
                    plan.update(require_visual_review_plan(args.visual_review_plan, plan, args.run))
                else:
                    plan.update(require_measurement_ready(args.measurement_report, args.case))
            except (OSError, ValueError) as error:
                parser.error(str(error))
        load_local_settings("e2e")
        if not os.environ.get("KUSAKARI_CANVAS_E2E_OPENAI_API_KEY", "").strip():
            parser.error("Set the dedicated E2E key privately before paid evaluation.")
    plan_path.write_text(json.dumps(plan, indent=2), encoding="utf-8")
    print(json.dumps({"run": args.run, "case": args.case, "quality": args.quality,
                      "live": args.live, "fixedConditionsMatch": True}), flush=True)
    if not args.live:
        return 0
    env = os.environ.copy()
    env.update({"KUSAKARI_CANVAS_AI_LIVE": "1", "KUSAKARI_CANVAS_AI_QUALITY_LIVE": "1",
                "KUSAKARI_CANVAS_AI_EVAL_QUALITY": args.quality,
                "KUSAKARI_CANVAS_AI_QUALITY_RUN": args.run,
                "KUSAKARI_CANVAS_AI_QUALITY_BASELINE": BASELINE,
                "KUSAKARI_CANVAS_AI_EVAL_PLAN": str(plan_path),
                "KUSAKARI_CANVAS_AI_EVIDENCE_DIR": str(evidence), "KUSAKARI_CANVAS_AI_MASKLESS": "0"})
    # Prevent inherited evaluation settings from choosing a different prompt than this plan.
    env["KUSAKARI_CANVAS_AI_EVAL_PROMPT_VERSION"] = prompt_version
    env["KUSAKARI_CANVAS_AI_EVAL_MASK_MARGIN_PX"] = str(args.mask_margin_px)
    node = shutil.which("node")
    if node is None:
        parser.error("Node.js is required for the browser evaluation.")
    command = [node, "scripts/e2e.mjs", "e2e/ai-quality.spec.ts", "--grep",
               f"AI quality {args.case}:", "--max-failures=1"]
    return subprocess.run(command, cwd=REPO_ROOT, env=env, check=False).returncode


if __name__ == "__main__":
    raise SystemExit(main())
