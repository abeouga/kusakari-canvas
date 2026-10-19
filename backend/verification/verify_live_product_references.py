"""Read-only validation of actual images for the current catalog and saved garden."""
import argparse
import hashlib
from pathlib import Path

from kusakari_canvas_api.ai_catalog import linked_products, resolve_reference
from kusakari_canvas_api.ai_config import AiSettings
from kusakari_canvas_api.ai_images import decode_image
from kusakari_canvas_api.ai_schemas import ReferenceRequest
from verification.retire_product_catalog import load, save


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, required=True)
    output = parser.parse_args().output_dir.resolve()
    assert output.parent == Path("D:/KusakariVerification").resolve()
    metadata = load(output, "normal-reference-metadata.json")
    settings = AiSettings("", "http://127.0.0.1:8086", image_origin="http://127.0.0.1:5186")
    products = linked_products(settings, [item["productId"] for item in metadata])
    images = []
    for item in metadata:
        content, summary = resolve_reference(settings, 1, ReferenceRequest(
            assetId="plant_modular", productId=item["productId"]), products)
        image = decode_image(content, expected_format="PNG")
        assert summary.source == "catalog" and summary.productId == item["productId"]
        images.append({"productId": item["productId"], "width": image.width, "height": image.height,
                       "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()})
    save(output, "normal-reference-images.json", {"passed": True, "actualImages": images,
                                                 "paidGenerationCalls": 0, "databaseWrites": 0})
    print(f"PASS: {len(images)} actual registered images fetched, decoded and bound to their product IDs")


if __name__ == "__main__":
    main()
