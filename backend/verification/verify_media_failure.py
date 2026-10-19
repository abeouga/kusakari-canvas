"""Real MySQL/API fault injection: unavailable object storage must not corrupt saved data."""
import json
import os
import socket
import subprocess
import sys
import time
from uuid import uuid4

import httpx
from PIL import Image
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from kusakari_canvas_api.ai_config import MODEL
from kusakari_canvas_api.ai_images import png_bytes
from kusakari_canvas_api.config import BACKEND_ROOT, REPO_ROOT, Settings
from kusakari_canvas_api.database import create_database_engine
from kusakari_canvas_api.history_models import HistoryEntity
from kusakari_canvas_api.history_service import image_data_url
from kusakari_canvas_api.models import GardenThumbnail
from kusakari_canvas_api.schemas import CreateGardenRequest, GardenDocumentRequest
from kusakari_canvas_api.service import create_garden, delete_garden, update_garden


def main():
    os.environ["KUSAKARI_CANVAS_PROFILE"] = "e2e"
    settings = Settings.from_env()
    engine = create_database_engine(settings)
    image = image_data_url(png_bytes(Image.new("RGB", (600, 400), "#acb795")))
    corners = [{"x": .1, "y": .9}, {"x": .9, "y": .9}, {"x": .9, "y": .1}, {"x": .1, "y": .1}]
    with Session(engine, expire_on_commit=False) as db:
        document = create_garden(db, settings.owner_id, CreateGardenRequest(name="object storage outage fixture"))
        fixture = document.model_dump()
        fixture["photo"] = {"dataUrl": image, "imageWidth": 600, "imageHeight": 400, "corners": corners, "boundary": corners}
        fixture["objects"] = [{"id": str(uuid4()), "assetId": "shrub_boxwood", "position": {"x": 0, "y": 0, "z": 0},
                               "rotation": {"x": 0, "y": 0, "z": 0}, "scale": {"x": 1, "y": 1, "z": 1}}]
        saved = update_garden(db, settings.owner_id, document.id, GardenDocumentRequest.model_validate(fixture))
    output = REPO_ROOT / "artifacts/deployment-refactor"
    output.mkdir(parents=True, exist_ok=True)
    try:
        with socket.socket() as refusal, socket.socket() as reservation, (output / "media-outage.log").open("w") as log:
            # Reserve a closed local endpoint, rather than sending test credentials anywhere external.
            refusal.bind(("127.0.0.1", 0))
            reservation.bind(("127.0.0.1", 0))
            port = reservation.getsockname()[1]
            reservation.close()
            env = {**os.environ, "KUSAKARI_CANVAS_PORT": str(port), "KUSAKARI_CANVAS_API_PREFIX": "",
                   "KUSAKARI_CANVAS_MEDIA_STORAGE": "s3", "KUSAKARI_CANVAS_MEDIA_BUCKET": "local-outage-fixture",
                   "KUSAKARI_CANVAS_S3_ENDPOINT": f"http://127.0.0.1:{refusal.getsockname()[1]}",
                   "AWS_ACCESS_KEY_ID": "local-fixture", "AWS_SECRET_ACCESS_KEY": "local-fixture",
                   "AWS_DEFAULT_REGION": "ap-northeast-1", "AWS_EC2_METADATA_DISABLED": "true"}
            process = subprocess.Popen([sys.executable, "-m", "kusakari_canvas_api", "serve"], cwd=BACKEND_ROOT,
                                       env=env, stdout=log, stderr=subprocess.STDOUT)
            try:
                with httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=30, trust_env=False) as client:
                    deadline = time.monotonic() + 45
                    while time.monotonic() < deadline:
                        if process.poll() is not None:
                            raise RuntimeError("Outage verification server failed to start.")
                        try:
                            if client.get("/health/ready").is_success:
                                break
                        except httpx.TransportError:
                            pass
                        time.sleep(.25)
                    path = f"/api/gardens/{document.id}"
                    original = saved.model_dump(mode="json")
                    assert client.get(path).json() == original
                    for method, route, payload in [
                        ("PUT", path, {**original, "name": "must not commit"}),
                        ("POST", path + "/thumbnail", {"revision": saved.revision, "dataUrl": image}),
                        ("POST", path + "/image-history", {"id": str(uuid4()), "document": original,
                         "beforeDataUrl": image, "afterDataUrl": image, "model": MODEL, "quality": "medium",
                         "generationMethod": "full_frame_v1", "inputImageCount": 2,
                         "referenceSummary": [{"assetId": "shrub_boxwood", "productId": "storage-fixture",
                                               "productName": "Storage fixture", "source": "uploaded"}]}),
                    ]:
                        response = client.request(method, route, json=payload)
                        assert response.status_code == 503 and response.json()["code"] == "MEDIA_UNAVAILABLE"
                        assert client.get(path).json() == original
                    with Session(engine) as db:
                        assert db.get(GardenThumbnail, document.id) is None
                        assert db.scalar(select(func.count()).select_from(HistoryEntity).where(
                            HistoryEntity.garden_id == document.id)) == 0
            finally:
                process.terminate()
                process.wait(timeout=15)
        report = {"result": "passed", "realMySqlAndApi": True, "fault": "closed loopback S3 endpoint",
                  "checks": ["legacy photo readable in S3 mode", "failed photo PUT preserves revision and data",
                             "failed thumbnail write leaves no row", "failed history write leaves no row"],
                  "successfulS3ConnectionVerified": False}
        (output / "media-outage.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(json.dumps(report))
    finally:
        with Session(engine, expire_on_commit=False) as db:
            delete_garden(db, settings.owner_id, document.id)
        engine.dispose()


if __name__ == "__main__":
    main()
