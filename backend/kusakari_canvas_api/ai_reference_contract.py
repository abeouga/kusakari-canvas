"""Shared reference identity for current product models and previously saved legacy history."""
from .errors import bad_request


def reference_key(asset_id: str, product_id: str | None) -> tuple[str, str | None]:
    # Distinct products share plant_modular; grouping only by assetId mixes their photographs.
    return asset_id, product_id if asset_id == "plant_modular" else None


def validate_reference_keys(document, plant_ids: set[str], references) -> None:
    expected = {reference_key(item.assetId, item.productId) for item in document.objects if item.assetId in plant_ids}
    actual = [reference_key(item.assetId, item.productId) for item in references]
    if len(actual) != len(set(actual)):
        bad_request("AI_DUPLICATE_REFERENCE", "同じ配置商品の参考画像を重複して指定できません。")
    if set(actual) != expected:
        bad_request("AI_REFERENCE_MISMATCH", "参考商品が撮影時の植物の商品IDと一致しません。撮影し直してください。")
