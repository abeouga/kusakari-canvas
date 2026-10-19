"""Validate capture coordinates and build a numbered scene inventory for the prompt."""

from .ai_schemas import AiImageRequest, LayoutPlacement, PixelBounds
from .errors import bad_request


def invalid_layout() -> None:
    bad_request("AI_LAYOUT_INVALID", "配置の位置・寸法情報が撮影内容と一致しません。完成イメージを撮影し直してください。")


def validate_bounds(bounds: PixelBounds | None, width: int, height: int) -> None:
    if bounds is not None and (bounds.x + bounds.width > width or bounds.y + bounds.height > height):
        invalid_layout()


def validate_measurement(item: LayoutPlacement, width: int, height: int) -> None:
    bounds, visible = item.bounds, item.visibleBounds
    validate_bounds(bounds, width, height)
    validate_bounds(visible, width, height)
    if item.measurement == "projected_box":
        if item.visibility != "unknown" or visible is not None:
            invalid_layout()
        return
    if item.visibility == "unknown":
        invalid_layout()
    if item.visibility == "outside":
        if bounds is not None or visible is not None:
            invalid_layout()
        return
    if bounds is None:
        invalid_layout()
    if item.visibility == "full":
        if visible is not None:
            invalid_layout()
        return
    if visible is None:
        invalid_layout()
    if (visible.x < bounds.x or visible.y < bounds.y
            or visible.x + visible.width > bounds.x + bounds.width
            or visible.y + visible.height > bounds.y + bounds.height):
        invalid_layout()


def layout_manifest(request: AiImageRequest, categories: dict[str, str]) -> list[dict]:
    photo = request.document.photo
    by_id = {str(item.placementId): item for item in request.layout}
    expected_ids = {item.id.lower() for item in request.document.objects}
    if len(by_id) != len(request.layout) or set(by_id) != expected_ids:
        invalid_layout()
    result = []
    for index, placement in enumerate(request.document.objects, start=1):
        item = by_id[placement.id.lower()]
        if item.assetId != placement.assetId:
            invalid_layout()
        validate_measurement(item, photo.imageWidth, photo.imageHeight)
        category = categories[item.assetId]
        action = "PRESERVE exactly as visible in image 1, including the existing 3D appearance"
        if category in {"tree", "shrub"}:
            action = "Retexture ONLY the visible plant at this location; preserve size and silhouette"
            if item.visibility in {"full", "outside"}:
                action = "Keep invisible in the output; do not expose or add this plant"
        result.append({"label": f"P{index}", "placementId": str(item.placementId), "assetId": item.assetId,
                       "category": category, "action": action, "visibility": item.visibility,
                       "measurement": item.measurement, "anchor": item.anchor.model_dump() if item.anchor else None,
                       "bounds": item.bounds.model_dump() if item.bounds else None,
                       "visibleBounds": item.visibleBounds.model_dump() if item.visibleBounds else None})
        if placement.productId is not None:
            result[-1]["productId"] = placement.productId
            result[-1]["productName"] = placement.productName
    return result
