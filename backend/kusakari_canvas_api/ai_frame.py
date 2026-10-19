"""Whole-scene coordinate conversion; never crop or add a second canvas around a photo."""

from math import sqrt

from PIL import Image, ImageChops

from .ai_config import MAX_EDGE, MAX_PIXELS
from .ai_images import opaque_reference, png_bytes
from .errors import bad_request


def generation_size(original: tuple[int, int]) -> tuple[int, int]:
    width, height = original
    if min(original) < 1 or max(original) > MAX_EDGE or width * height > MAX_PIXELS:
        bad_request("AI_IMAGE_DIMENSIONS", "写真の寸法が生成可能な範囲を超えています。")
    if max(original) > 3 * min(original):
        bad_request("AI_IMAGE_ASPECT_RATIO", "AI画像生成には縦横比が1:3〜3:1の写真を指定してください。")
    # Keep the previous minimum pixel budget, but allocate it to the photo's own aspect ratio.
    scale = min(max(1, sqrt(1024 * 1024 / (width * height))), MAX_EDGE / max(original))
    width, height = (max(16, round(edge * scale / 16) * 16) for edge in original)
    if width > 3 * height:
        width = 3 * height
    if height > 3 * width:
        height = 3 * width
    while width * height > MAX_PIXELS:
        if width >= height:
            width -= 16
        else:
            height -= 16
    return width, height


def resize_scene_image(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    return opaque_reference(image).resize(size, Image.Resampling.LANCZOS)


def scene_mask(editable: Image.Image, size: tuple[int, int]) -> bytes:
    mask = Image.new("RGBA", size, (0, 0, 0, 255))
    mask.putalpha(ImageChops.invert(editable.resize(size, Image.Resampling.NEAREST)))
    content = png_bytes(mask)
    if len(content) >= 4_000_000:
        bad_request("AI_MASK_TOO_LARGE", "編集マスクが4MBの上限を超えます。")
    return content


def resize_layout(layout: list[dict], original: tuple[int, int], size: tuple[int, int]) -> list[dict]:
    scale_x, scale_y = size[0] / original[0], size[1] / original[1]
    result = []
    for item in layout:
        transformed = dict(item)
        for field in ("anchor", "bounds", "visibleBounds"):
            coordinates = item.get(field)
            if coordinates is not None:
                transformed[field] = {key: round(value * (scale_x if key in {"x", "width"} else scale_y), 4)
                                      for key, value in coordinates.items()}
        result.append(transformed)
    return result
