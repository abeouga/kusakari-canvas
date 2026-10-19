"""Verify output preservation and failures that cannot be prescribed to a live model.

These controlled PNGs check the image boundary; they do not replace real API E2E.
See docs/ai-image-generation.md for the independent-verification rationale.
"""

import base64
import io
import random

from PIL import Image

from kusakari_canvas_api.ai_config import MAX_AFTER_IMAGE_BYTES
from kusakari_canvas_api.ai_images import (
    decode_data_url,
    editable_mask,
    finalize_generated_image,
    pad_image,
    padded_size,
    png_bytes,
    provider_mask,
)
from kusakari_canvas_api.errors import ApiError


def expect_error(code, operation):
    try:
        operation()
    except ApiError as error:
        assert error.code == code, (error.code, code)
        return
    raise AssertionError(f"Expected {code}")


def verify_full_frame():
    original_size = (37, 23)
    before = Image.new("RGBA", original_size, (11, 33, 55, 255))
    size = padded_size(original_size)
    assert size == (1024, 1024)
    padded = pad_image(before, size)
    assert padded.crop((0, 0, *original_size)).tobytes() == before.convert("RGB").tobytes()
    assert padded.getpixel((37, 0)) == (255, 255, 255)
    generated = Image.new("RGBA", size, (221, 17, 139, 255))
    for y in range(28):
        for x in range(42):
            generated.putpixel((x, y), (x * 5, y * 7, (x + y) * 3, 255))
    result = finalize_generated_image(png_bytes(generated), original_size, size)
    output = decode_data_url(result, png_only=True, opaque=True)
    expected = generated
    assert output.size == size
    assert base64.b64decode(result.split(',')[1]) == png_bytes(generated)
    assert output.tobytes() == expected.tobytes()
    assert output.getpixel((0, 0)) != before.getpixel((0, 0))
    assert output.getpixel((output.width - 1, output.height - 1)) == generated.getpixel((generated.width - 1, generated.height - 1))
    unchanged_size = finalize_generated_image(png_bytes(expected), size, size)
    assert decode_data_url(unchanged_size).tobytes() == expected.tobytes()
    return {"photo_pixels": 37 * 23, "provider_pixel_mismatches": 0, "same_size_pixel_mismatches": 0}


def verify_api_mask():
    coverage = Image.new("RGBA", (37, 23), (0, 0, 0, 255))
    for y in range(3, 8):
        for x in range(4, 9):
            coverage.putpixel((x, y), (255, 0, 0, 255))
    for y in range(1, 14):
        for x in range(10, 15):
            coverage.putpixel((x, y), (0, 255, 0, 255))
    editable = editable_mask(coverage)
    size = padded_size(coverage.size)
    with Image.open(io.BytesIO(provider_mask(editable, size))) as image:
        mask = image.convert("RGBA")
    assert mask.getpixel((37, 0))[3] == 255
    for y in range(coverage.height):
        for x in range(coverage.width):
            near_plant = -4 <= x <= 16 and -5 <= y <= 15
            is_furniture = 10 <= x < 15 and 1 <= y < 14
            can_edit = near_plant and not is_furniture
            assert (editable.getpixel((x, y)) == 255) == can_edit
            assert mask.getpixel((x, y))[3] == (0 if can_edit else 255)
    return {"guide_checked": True, "used_for_output_compositing": False}


def verify_large_output():
    size = (1600, 1792)
    pixels = random.Random(42).randbytes(size[0] * size[1] * 3)
    generated = Image.frombytes("RGB", size, pixels)
    content = png_bytes(generated)
    assert 8_000_000 < len(content) < MAX_AFTER_IMAGE_BYTES
    result = finalize_generated_image(content, size, size)
    output = decode_data_url(result, png_only=True, opaque=True, max_bytes=MAX_AFTER_IMAGE_BYTES)
    assert output.tobytes() == generated.convert("RGBA").tobytes()
    return {"provider_bytes": len(content), "provider_pixel_mismatches": 0}


def verify_invalid_results():
    original_size = (37, 23)
    size = padded_size(original_size)
    wrong_size = png_bytes(Image.new("RGBA", (1023, 1024), (1, 2, 3, 255)))
    expect_error("AI_OUTPUT_DIMENSION_MISMATCH", lambda: finalize_generated_image(wrong_size, original_size, size))
    transparent = png_bytes(Image.new("RGBA", size, (1, 2, 3, 0)))
    expect_error("AI_OUTPUT_TRANSPARENT", lambda: finalize_generated_image(transparent, original_size, size))
    expect_error("AI_OUTPUT_INVALID", lambda: finalize_generated_image(b"not an image", original_size, size))
    oversized = b"x" * (MAX_AFTER_IMAGE_BYTES + 1)
    expect_error("AI_OUTPUT_TOO_LARGE", lambda: finalize_generated_image(oversized, original_size, size))
    opaque = png_bytes(Image.new("RGBA", size, (1, 2, 3, 255)))
    for invalid_size in ((0, 23), (37, -1), (2049, 23), (2048, 2048)):
        expect_error("AI_OUTPUT_DIMENSION_MISMATCH", lambda: finalize_generated_image(opaque, invalid_size, size))
    expect_error("AI_IMAGE_INVALID", lambda: decode_data_url("data:image/png;base64,invalid!"))
    transparent_input = "data:image/png;base64," + base64.b64encode(transparent).decode()
    expect_error("AI_IMAGE_TRANSPARENT", lambda: decode_data_url(transparent_input, opaque=True))
    expect_error("AI_PADDED_IMAGE_TOO_LARGE", lambda: padded_size((2048, 2048)))
    expect_error("AI_NO_VISIBLE_PLANTS", lambda: editable_mask(Image.new("RGBA", original_size, (0, 255, 0, 255))))
    return 12


if __name__ == "__main__":
    print({"full_frame": verify_full_frame(), "api_mask": verify_api_mask(),
           "large_output": verify_large_output(), "invalid_result_checks": verify_invalid_results()})
