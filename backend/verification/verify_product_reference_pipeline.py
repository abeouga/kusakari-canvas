"""Real EC metadata/images -> validated reference bytes and placement bindings; no AI call."""
import argparse
import hashlib
import json
import os
from pathlib import Path
from urllib.request import urlopen

from kusakari_canvas_api.ai_catalog import linked_products, raster_url, resolve_reference
from kusakari_canvas_api.ai_config import AiSettings
from kusakari_canvas_api.ai_images import decode_image
from kusakari_canvas_api.ai_layout import layout_manifest
from kusakari_canvas_api.ai_prompt import generation_prompt, image_roles
from kusakari_canvas_api.ai_schemas import AiImageRequest
from verification.retire_product_catalog import load, save


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, required=True)
    output = parser.parse_args().output_dir.resolve()
    assert output.is_dir(), "The browser must save its captured request first"
    request = AiImageRequest.model_validate(load(output, "generation-request.json"))
    ec_port = os.environ.get("KUSAKARI_EC_E2E_API_PORT", "18186")
    image_origin = os.environ.get("KUSAKARI_EC_E2E_WEB_URL", "http://127.0.0.1:15286")
    canvas_origin = os.environ.get("KUSAKARI_CANVAS_E2E_API_URL", "http://127.0.0.1:18081")
    settings = AiSettings("", f"http://127.0.0.1:{ec_port}", image_origin=image_origin)
    ids = [item.productId for item in request.references]
    products = linked_products(settings, ids)
    with urlopen(f"{canvas_origin}/api/assets", timeout=10) as response:
        categories = {item["id"]: item["category"] for item in json.load(response)}
    layout = layout_manifest(request, categories)
    summaries, images = [], []
    for reference in request.references:
        content, summary = resolve_reference(settings, request.storeId, reference, products)
        image = decode_image(content, expected_format="PNG")
        assert summary.productId == reference.productId and summary.source == "catalog"
        summaries.append(summary)
        images.append({"productId": reference.productId, "width": image.width, "height": image.height,
                       "sha256": hashlib.sha256(content).hexdigest()})
    assert len({item["sha256"] for item in images}) == len(ids), "Different fixtures must have distinct images"
    roles = image_roles(request, summaries, layout)
    for role, reference in zip(roles[1:], request.references, strict=True):
        assert role["productId"] == reference.productId
        expected = [f"P{index}" for index, item in enumerate(request.document.objects, 1)
                    if item.productId == reference.productId]
        assert role["placements"] == expected
    prompt = generation_prompt(request, summaries, layout)
    assert all(identifier in prompt for identifier in ids)
    for path in ("/images/../secret.png", "https://other.invalid/images/a.png", "//other.invalid/images/a.png",
                 "/images/%2e%2e/a.png", "/images/a.svg", "/images/a.png?other=1"):
        assert raster_url(settings, path) is None
    assert raster_url(settings, "/images/garden-demo/olive.png") is not None
    save(output, "reference-pipeline.json", {"passed": True, "actualCatalogImages": images,
                                           "referenceRoles": roles[1:], "urlRestrictionsPassed": True,
                                           "paidGenerationCalls": 0})
    print("PASS: actual reference bytes and per-product placement bindings")


if __name__ == "__main__":
    main()
