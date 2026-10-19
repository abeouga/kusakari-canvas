"""Controlled geometry checks, NOT AI output quality. Rationale: docs/before-after-resolution.md."""
import argparse
import base64
import copy
import io
import json
from pathlib import Path
from types import SimpleNamespace

from PIL import Image, ImageDraw

from kusakari_canvas_api.ai_config import MAX_EDGE, MAX_PIXELS
from kusakari_canvas_api.ai_frame import generation_size, resize_layout, resize_scene_image, scene_mask
from kusakari_canvas_api.ai_images import decode_data_url, editable_mask, finalize_generated_image, png_bytes
from kusakari_canvas_api.ai_prompt import generation_prompt
from verification.verify_ai_images import expect_error, verify_invalid_results, verify_large_output

SIZES = [(259, 194), (194, 259), (320, 180), (600, 400), (1280, 853),
         (1600, 1792), (2048, 1800), (1024, 1024), (1800, 600), (600, 1800)]
COLORS = [(220, 40, 40), (40, 190, 70), (40, 80, 220), (240, 200, 40)]


def data_url(image):
    return "data:image/png;base64," + base64.b64encode(png_bytes(image)).decode("ascii")


def landmarks(size):
    width, height = size
    image = Image.new("RGB", size)
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, width // 2, height // 2), fill=COLORS[0])
    draw.rectangle((width // 2, 0, width, height // 2), fill=COLORS[1])
    draw.rectangle((0, height // 2, width // 2, height), fill=COLORS[2])
    draw.rectangle((width // 2, height // 2, width, height), fill=COLORS[3])
    draw.rectangle((width * .4, height * .4, width * .6, height * .6), fill=(200, 30, 190))
    return image


def verify_frames(directory):
    results, fixtures = [], []
    for original in SIZES:
        before = landmarks(original)
        size = generation_size(original)
        assert all(edge % 16 == 0 for edge in size)
        assert max(size) <= MAX_EDGE and 655_360 <= size[0] * size[1] <= MAX_PIXELS
        assert max(size) <= 3 * min(size)
        assert abs((size[0] / size[1]) / (original[0] / original[1]) - 1) < .02
        prepared = resize_scene_image(before.convert("RGBA"), size)
        # A controlled full-scene output with changed center tests output geometry only.
        generated = landmarks(size)
        ImageDraw.Draw(generated).rectangle((size[0] * .4, size[1] * .4, size[0] * .6, size[1] * .6),
                                           fill=(25, 200, 205))
        result = finalize_generated_image(png_bytes(generated), original, size)
        after = decode_data_url(result, opaque=True)
        assert after.size == size
        assert base64.b64decode(result.split(',')[1]) == png_bytes(generated)
        for x, y, color in [(0, 0, COLORS[0]), (1, 0, COLORS[1]), (0, 1, COLORS[2]), (1, 1, COLORS[3])]:
            for image in (before, prepared, after):
                point = (round((.1 + x * .8) * (image.width - 1)), round((.1 + y * .8) * (image.height - 1)))
                assert image.getpixel(point)[:3] == color, (original, size, point)
        assert after.getpixel((after.width // 2, after.height // 2))[:3] == (25, 200, 205)
        if original in SIZES[:3]:
            old_crop = generated.crop((0, 0, *original))
            assert old_crop.getpixel((original[0] - 1, original[1] - 1)) != COLORS[3]
        same = decode_data_url(finalize_generated_image(png_bytes(before), original, original))
        assert same.tobytes() == before.convert("RGBA").tobytes()
        results.append({"original": original, "provider": size, "allCornersAndCenterPreserved": True,
                        "sameSizePixelsUnchanged": True, "providerBytesUnchanged": True})
        if original in SIZES[:3]:
            fixtures.append({"width": original[0], "height": original[1], "providerSize": size,
                             "beforeDataUrl": data_url(before), "afterDataUrl": result,
                             "highResolutionDataUrl": data_url(generated)})
            before.save(directory / f"{original[0]}x{original[1]}-before.png")
            after.save(directory / f"{original[0]}x{original[1]}-after.png")
    (directory / "fixtures.json").write_text(json.dumps(fixtures), encoding="utf-8")
    return results


def verify_alignment():
    original, size = (32, 24), (160, 120)
    coverage = Image.new("RGBA", original, (0, 0, 0, 255))
    ImageDraw.Draw(coverage).rectangle((18, 12, 22, 18), fill=(255, 0, 0, 255))
    ImageDraw.Draw(coverage).rectangle((23, 0, 25, 23), fill=(0, 255, 0, 255))
    for margin in (0, 8):
        editable = editable_mask(coverage, margin)
        mask = Image.open(io.BytesIO(scene_mask(editable, size))).convert("RGBA")
        for y in range(size[1]):
            for x in range(size[0]):
                assert mask.getpixel((x, y))[3] == 255 - editable.getpixel((x // 5, y // 5))
        assert mask.getpixel((24 * 5, 15 * 5))[3] == 255
    layout = [{"label": "P1", "placementId": "fixture", "assetId": "plant_modular", "productId": "fixture",
               "anchor": {"x": 20, "y": 19}, "bounds": {"x": 18, "y": 12, "width": 5, "height": 7},
               "visibleBounds": {"x": 18, "y": 12, "width": 4, "height": 6}},
              {"label": "P2", "placementId": "outside", "anchor": {"x": -5, "y": 26}, "bounds": None, "visibleBounds": None}]
    snapshot = copy.deepcopy(layout)
    converted = resize_layout(layout, original, size)
    assert layout == snapshot
    assert converted[0]["anchor"] == {"x": 100, "y": 95}
    assert converted[0]["bounds"] == {"x": 90, "y": 60, "width": 25, "height": 35}
    assert converted[0]["visibleBounds"] == {"x": 90, "y": 60, "width": 20, "height": 30}
    assert converted[1]["anchor"] == {"x": -25, "y": 130}
    assert converted[1]["bounds"] is None and converted[1]["visibleBounds"] is None
    assert resize_layout(layout, original, (176, 112))[0]["anchor"] == {"x": 110, "y": 88.6667}
    request = SimpleNamespace(document=SimpleNamespace(photo=SimpleNamespace(imageWidth=32, imageHeight=24)))
    for version in ("scene_layout_v1", "scene_layout_v2"):
        prompt = generation_prompt(request, [], converted, canvas_size=size, prompt_version=version)
        assert "160x120" in prompt and "32x24" not in prompt
        assert '"anchor":{"x":100.0,"y":95.0}' in prompt
        assert "white right/bottom padding" not in prompt
        assert "without padding, cropping or zoom" in prompt
    return {"maskFurnitureAndCoordinatesAligned": True, "originalLayoutUnchanged": True, "promptCanvasMatches": True}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, required=True)
    directory = parser.parse_args().output_dir
    directory.mkdir(parents=True, exist_ok=True)
    for invalid in ((0, 23), (37, -1), (2049, 23), (2048, 2048)):
        expect_error("AI_IMAGE_DIMENSIONS", lambda: generation_size(invalid))
    for invalid in ((1, 100), (100, 1)):
        expect_error("AI_IMAGE_ASPECT_RATIO", lambda: generation_size(invalid))
    report = {"fullFrame": verify_frames(directory), "alignment": verify_alignment(),
              "largeOutput": verify_large_output(), "invalidResultChecks": verify_invalid_results(), "paidRequests": 0}
    (directory / "pixel-checks.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
