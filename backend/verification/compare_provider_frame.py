"""Compare stored After pixels with the complete, scaled provider frame, offline."""
import argparse
import json
from pathlib import Path

from PIL import Image, ImageChops


def compare(directory: Path):
    metadata = json.loads((directory / "metadata.json").read_text(encoding="utf-8"))
    with Image.open(directory / "provider.png") as image:
        raw = image.convert("RGBA")
    with Image.open(directory / "after.png") as image:
        after = image.convert("RGBA")
    assert list(raw.size) == metadata["providerSize"]
    if metadata["generationMethod"] == "full_frame_v3":
        assert after.size == raw.size
        assert (directory / "provider.png").read_bytes() == (directory / "after.png").read_bytes()
        expected = raw
    elif metadata["generationMethod"] == "full_frame_v2":
        assert list(after.size) == metadata["originalSize"]
        expected = raw.resize(after.size, Image.Resampling.LANCZOS)
    else:
        assert list(after.size) == metadata["originalSize"]
        expected = raw.crop((0, 0, *after.size))
    difference = ImageChops.difference(expected, after)
    mismatch = difference.convert("RGB").getbbox() is not None or difference.getchannel("A").getbbox() is not None
    assert not mismatch, "Stored output does not match its generation method"
    assert after.getchannel("A").getextrema() == (255, 255)
    return {"mismatchedPixels": 0, "transparentPixels": 0, "width": after.width, "height": after.height}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("directory", type=Path)
    print(json.dumps(compare(parser.parse_args().directory)))
