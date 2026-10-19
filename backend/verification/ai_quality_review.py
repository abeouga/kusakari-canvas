"""Validate the explicitly revised practical review before a paid sample starts."""
import hashlib
import json
from pathlib import Path


def require_visual_review_plan(path: str, plan: dict, run: str) -> dict:
    report_path = Path(path).resolve()
    report = json.loads(report_path.read_text(encoding="utf-8"))
    if (not isinstance(report, dict) or report.get("reviewMode") not in {"practical_v1", "mask_margin_v1"}
            or report.get("strictPositionMeasurementRequired") is not False
            or report.get("generationRequestsAllowed") != 2):
        raise ValueError("Invalid practical review plan. No generation was submitted.")
    if plan["quality"] != "medium" or plan["promptVersion"] != "scene_layout_v2":
        raise ValueError("Practical review requires the frozen candidate and medium quality.")
    cases = report.get("cases")
    if not isinstance(cases, dict) or set(cases) != {"single", "overlap"}:
        raise ValueError("Practical review must contain single and overlap cases.")
    expected = cases[plan["case"]]
    if not isinstance(expected, dict) or expected.get("run") != run:
        raise ValueError("Run is not registered in the practical review plan.")
    for field in ("baseline", "model", "quality", "promptVersion", "originalSize", "providerSize",
                  "imageHashes", "maskSha256", "promptSha256", "layout"):
        value = plan[field]
        if isinstance(value, tuple):
            value = list(value)
        if expected.get(field) != value:
            raise ValueError(f"Practical review conditions changed: {field}")
    expected_margin = expected.get("maskMarginPx", 8)
    if expected_margin != plan.get("maskMarginPx", 8):
        raise ValueError("Mask margin differs from the registered review plan.")
    return {"reviewMode": report["reviewMode"], "strictPositionMeasurementRequired": False,
            "visualReviewPlan": str(report_path),
            "visualReviewPlanSha256": hashlib.sha256(report_path.read_bytes()).hexdigest()}
