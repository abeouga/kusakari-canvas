import base64
import binascii
import io
import warnings

from PIL import Image, ImageChops, ImageFilter, UnidentifiedImageError

from .ai_config import (
    DEFAULT_MASK_MARGIN_PX,
    MAX_AFTER_IMAGE_BYTES,
    MAX_EDGE,
    MAX_IMAGE_BYTES,
    MAX_PIXELS,
    SUPPORTED_MASK_MARGINS,
)
from .errors import ApiError, bad_request

MIME_FORMATS = {"image/png": "PNG", "image/jpeg": "JPEG", "image/webp": "WEBP"}


def decode_image(content: bytes, *, expected_format: str | None = None,
                 max_bytes: int = MAX_IMAGE_BYTES) -> Image.Image:
    if not 0 < len(content) <= max_bytes:
        bad_request("AI_IMAGE_SIZE", f"画像は1枚{max_bytes // 1_000_000}MB以内で指定してください。")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(content)) as image:
                if image.format not in MIME_FORMATS.values():
                    raise ValueError()
                if expected_format and image.format != expected_format:
                    raise ValueError()
                width, height = image.size
                if max(width, height) > MAX_EDGE or width * height > MAX_PIXELS:
                    bad_request("AI_IMAGE_DIMENSIONS", "画像は長辺2048px、総画素数3,686,400以内で指定してください。")
                if getattr(image, "n_frames", 1) != 1:
                    raise ValueError()
                image.verify()
            with Image.open(io.BytesIO(content)) as image:
                image.load()
                return image.convert("RGBA")
    except (ValueError, OSError, UnidentifiedImageError, Image.DecompressionBombError,
            Image.DecompressionBombWarning, SyntaxError):
        bad_request("AI_IMAGE_INVALID", "画像データを読み取れません。PNG・JPEG・WebPの静止画を指定してください。")


def decode_data_url(value: str, *, png_only: bool = False, opaque: bool = False,
                    max_bytes: int = MAX_IMAGE_BYTES) -> Image.Image:
    max_data_url_length = (max_bytes + 2) // 3 * 4 + 32
    if len(value) > max_data_url_length:
        bad_request("AI_IMAGE_SIZE", f"画像は1枚{max_bytes // 1_000_000}MB以内で指定してください。")
    prefix, separator, encoded = value.partition(",")
    mime = prefix.removeprefix("data:").removesuffix(";base64")
    if not separator or prefix != f"data:{mime};base64" or mime not in MIME_FORMATS:
        bad_request("AI_IMAGE_INVALID", "Base64形式のPNG・JPEG・WebP画像を指定してください。")
    if png_only and mime != "image/png":
        bad_request("AI_IMAGE_INVALID", "撮影画像と編集領域はPNG形式で指定してください。")
    try:
        content = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error):
        bad_request("AI_IMAGE_INVALID", "画像のBase64形式が不正です。")
    image = decode_image(content, expected_format=MIME_FORMATS[mime], max_bytes=max_bytes)
    if opaque and image.getchannel("A").getextrema() != (255, 255):
        bad_request("AI_IMAGE_TRANSPARENT", "Before画像と編集領域画像は不透明なPNGで指定してください。")
    return image


def png_bytes(image: Image.Image) -> bytes:
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def opaque_reference(image: Image.Image) -> Image.Image:
    background = Image.new("RGBA", image.size, "white")
    background.alpha_composite(image)
    return background.convert("RGB")


def require_same_size(image: Image.Image, before: Image.Image) -> None:
    if image.size != before.size:
        bad_request("AI_IMAGE_DIMENSION_MISMATCH", "Before画像と編集領域の寸法を一致させてください。")


def editable_mask(coverage: Image.Image, margin_px: int = DEFAULT_MASK_MARGIN_PX) -> Image.Image:
    if type(margin_px) is not int or margin_px not in SUPPORTED_MASK_MARGINS:
        bad_request("AI_MASK_MARGIN_INVALID", "編集マスクの余裕幅が不正です。")
    red, green, _blue, _alpha = coverage.split()
    plants = red.point(lambda value: 255 if value > 2 else 0)
    furniture = green.point(lambda value: 255 if value > 2 else 0)
    expanded = plants
    if margin_px > 0:
        expanded = plants.filter(ImageFilter.MaxFilter(margin_px * 2 + 1))
    editable = ImageChops.multiply(expanded, ImageChops.invert(furniture))
    if editable.getbbox() is None:
        bad_request("AI_NO_VISIBLE_PLANTS", "画像内に編集できる植物がありません。")
    return editable


def padded_size(size: tuple[int, int]) -> tuple[int, int]:
    # Frozen full_frame_v1 evaluation only. Live generation uses ai_frame.generation_size.
    width, height = size
    width = max(1024, (width + 15) // 16 * 16)
    height = max(1024, (height + 15) // 16 * 16)
    if max(width, height) > MAX_EDGE or width * height > MAX_PIXELS:
        bad_request("AI_PADDED_IMAGE_TOO_LARGE", "16px単位の余白追加後の画像が上限を超えます。写真を小さくしてください。")
    return width, height


def pad_image(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    # Only append on the right/bottom: source pixels keep their original coordinates.
    output = Image.new("RGBA", size, (255, 255, 255, 255))
    output.alpha_composite(image, (0, 0))
    return output.convert("RGB")


def provider_mask(editable: Image.Image, size: tuple[int, int]) -> bytes:
    alpha = Image.new("L", size, 255)
    alpha.paste(ImageChops.invert(editable), (0, 0))
    mask = Image.new("RGBA", size, (0, 0, 0, 255))
    mask.putalpha(alpha)
    content = png_bytes(mask)
    if len(content) >= 4_000_000:
        bad_request("AI_MASK_TOO_LARGE", "編集マスクが4MBの上限を超えます。")
    return content


def finalize_generated_image(content: bytes, original_size: tuple[int, int],
                             expected_size: tuple[int, int]) -> str:
    if len(content) > MAX_AFTER_IMAGE_BYTES:
        raise ApiError(502, "AI_OUTPUT_TOO_LARGE", "生成画像が20MBの出力上限を超えています。")
    try:
        generated = decode_image(content, expected_format="PNG", max_bytes=MAX_AFTER_IMAGE_BYTES)
    except ApiError:
        raise ApiError(502, "AI_OUTPUT_INVALID", "生成APIが有効なPNG画像を返しませんでした。") from None
    if generated.size != expected_size:
        raise ApiError(502, "AI_OUTPUT_DIMENSION_MISMATCH", "生成画像の寸法が要求と一致しません。画像は採用していません。")
    if generated.getchannel("A").getextrema() != (255, 255):
        raise ApiError(502, "AI_OUTPUT_TRANSPARENT", "生成APIが不透明な画像を返しませんでした。")
    width, height = original_size
    if min(original_size) < 1 or max(original_size) > MAX_EDGE or width * height > MAX_PIXELS:
        raise ApiError(502, "AI_OUTPUT_DIMENSION_MISMATCH", "元写真の寸法が有効な範囲外です。画像は採用していません。")
    # Display scaling belongs to the comparison frame. Keep every provider pixel and PNG byte.
    return "data:image/png;base64," + base64.b64encode(content).decode("ascii")
