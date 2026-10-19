"""Real API/MySQL + a real, loopback-only S3 store. No AWS or mocked happy paths."""
import argparse
import base64
import hashlib
import io
import json
import os
import secrets
import socket
import subprocess
import sys
import time
from pathlib import Path
from uuid import uuid4

import boto3
import httpx
from botocore.config import Config
from PIL import Image
from sqlalchemy.orm import Session

from kusakari_canvas_api.ai_config import MODEL
from kusakari_canvas_api.config import BACKEND_ROOT, REPO_ROOT, Settings
from kusakari_canvas_api.database import create_database_engine
from kusakari_canvas_api.history_models import HistoryEntity
from kusakari_canvas_api.models import Garden, GardenThumbnail
from kusakari_canvas_api.schemas import CreateGardenRequest, GardenDocumentRequest
from kusakari_canvas_api.service import create_garden, delete_garden, update_garden


def free_port():
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


def image_url(color, extension="PNG"):
    output = io.BytesIO()
    Image.new("RGB", (600, 400), color).save(output, format=extension)
    mime = "image/jpeg" if extension == "JPEG" else "image/png"
    return f"data:{mime};base64," + base64.b64encode(output.getvalue()).decode("ascii")


def photo(value):
    corners = [{"x": .1, "y": .9}, {"x": .9, "y": .9}, {"x": .9, "y": .1}, {"x": .1, "y": .1}]
    return {"dataUrl": value, "imageWidth": 600, "imageHeight": 400, "corners": corners, "boundary": corners}


def start(command, env, log):
    return subprocess.Popen(command, cwd=BACKEND_ROOT, env=env, stdout=log, stderr=subprocess.STDOUT,
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))


def stop(process):
    if process is not None and process.poll() is None:
        process.terminate()
        process.wait(timeout=20)


def ready(process, probe):
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError("Owned verification process exited before readiness.")
        try:
            if probe():
                return
        except Exception:
            pass
        time.sleep(.25)
    raise RuntimeError("Owned verification process was not ready in 60 seconds.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--storage-executable", type=Path, required=True)
    parser.add_argument("--storage-directory", type=Path, required=True)
    args = parser.parse_args()
    executable = args.storage_executable.resolve(strict=True)
    directory = args.storage_directory.resolve()
    directory.mkdir(exist_ok=False)  # Never adopt an existing storage service or existing data.
    os.environ["KUSAKARI_CANVAS_PROFILE"] = "e2e"
    os.environ["KUSAKARI_CANVAS_MEDIA_STORAGE"] = "database"
    settings = Settings.from_env()
    if settings.database_url.host != "127.0.0.1":
        raise ValueError("Only the dedicated loopback E2E database is permitted.")
    engine = create_database_engine(settings)
    output = REPO_ROOT / "artifacts/deployment-refactor"
    output.mkdir(parents=True, exist_ok=True)
    ports = {name: free_port() for name in ["master", "master.grpc", "volume", "volume.grpc",
                                          "filer", "filer.grpc", "s3", "s3.grpc", "api"]}
    if len(set(ports.values())) != len(ports):
        raise RuntimeError("Verification ports collided; no service started.")
    endpoint = f"http://127.0.0.1:{ports['s3']}"
    bucket = "kusakari-media-verification"
    secret = secrets.token_urlsafe(32)
    credentials = {"AWS_ACCESS_KEY_ID": "local-verification", "AWS_SECRET_ACCESS_KEY": secret,
                   "AWS_DEFAULT_REGION": "us-east-1", "AWS_EC2_METADATA_DISABLED": "true"}
    store_env = {**os.environ, **credentials, "S3_BUCKET": bucket, "S3_TABLE_BUCKET": "", "GOMEMLIMIT": "256MiB"}
    api_env = {**os.environ, **credentials, "KUSAKARI_CANVAS_PORT": str(ports["api"]),
               "KUSAKARI_CANVAS_API_PREFIX": "", "KUSAKARI_CANVAS_MEDIA_STORAGE": "s3",
               "KUSAKARI_CANVAS_MEDIA_BUCKET": bucket, "KUSAKARI_CANVAS_S3_ENDPOINT": endpoint}
    storage_command = [str(executable), "mini", f"-dir={directory}", "-ip=127.0.0.1", "-ip.bind=127.0.0.1",
                       "-master.telemetry=false", "-admin.ui=false", "-webdav=false",
                       "-s3.port.iceberg=0", "-s3.port.lance=0", "-master.volumeSizeLimitMB=64", "-volume.max=4",
                       "-s3.allowDeleteBucketNotEmpty=false", "-s3.autoCreateBucket=false"]
    for name in ("master", "volume", "filer", "s3"):
        storage_command += [f"-{name}.port={ports[name]}", f"-{name}.port.grpc={ports[name + '.grpc']}"]
    storage = boto3.client("s3", endpoint_url=endpoint, region_name="us-east-1",
                           aws_access_key_id=credentials["AWS_ACCESS_KEY_ID"], aws_secret_access_key=secret,
                           config=Config(connect_timeout=1, read_timeout=3, retries={"max_attempts": 0},
                                         s3={"addressing_style": "path"}))
    legacy_image, current_image = image_url("#738c50"), image_url("#b5bf91", "JPEG")
    before, after = image_url("#8ea1ae"), image_url("#a8bc91")
    owned_ids = []
    store_process = api_process = None
    log_paths = [output / "object-storage.log", output / "object-storage-api.log"]
    try:
        with Session(engine, expire_on_commit=False) as db:
            legacy = create_garden(db, settings.owner_id, CreateGardenRequest(name="legacy storage fixture"))
            owned_ids.append(legacy.id)
            legacy = update_garden(db, settings.owner_id, legacy.id, GardenDocumentRequest.model_validate(
                {**legacy.model_dump(), "photo": photo(legacy_image)}))
        with log_paths[0].open("w") as store_log, log_paths[1].open("w") as api_log:
            store_process = start(storage_command, store_env, store_log)
            ready(store_process, lambda: storage.head_bucket(Bucket=bucket)["ResponseMetadata"]["HTTPStatusCode"] == 200)
            api_process = start([sys.executable, "-m", "kusakari_canvas_api", "serve"], api_env, api_log)
            with httpx.Client(base_url=f"http://127.0.0.1:{ports['api']}", timeout=30, trust_env=False) as client:
                ready(api_process, lambda: client.get("/health/ready").is_success)
                assert client.get(f"/api/gardens/{legacy.id}").json() == legacy.model_dump(mode="json")
                created = client.post("/api/gardens", json={"name": "S3 roundtrip fixture", "width": 10, "depth": 8})
                assert created.status_code == 201
                document = created.json()
                owned_ids.append(document["id"])
                path = f"/api/gardens/{document['id']}"
                document["photo"] = photo(current_image)
                document["objects"] = [{"id": str(uuid4()), "assetId": "shrub_boxwood", "position": {"x": 0, "y": 0, "z": 0},
                                        "rotation": {"x": 0, "y": 0, "z": 0}, "scale": {"x": 1, "y": 1, "z": 1}}]
                response = client.put(path, json=document)
                assert response.status_code == 200, response.text
                saved = response.json()
                assert saved["photo"]["dataUrl"] == current_image
                assert client.post(path + "/thumbnail", json={"revision": saved["revision"], "dataUrl": before}).status_code == 204
                scene = client.get(path + "/thumbnail")
                assert scene.headers["x-thumbnail-source"] == "scene"
                history = {"id": str(uuid4()), "document": saved, "beforeDataUrl": before, "afterDataUrl": after,
                           "model": MODEL, "quality": "medium", "generationMethod": "full_frame_v1", "inputImageCount": 2,
                           "referenceSummary": [{"assetId": "shrub_boxwood", "productId": "storage-fixture",
                                                 "productName": "Storage fixture", "source": "uploaded"}]}
                for _ in range(2):
                    response = client.post(path + "/image-history", json=history)
                    assert response.status_code == 200, response.text
                history_path = path + "/image-history/" + history["id"]
                restored = client.get(history_path).json()
                assert restored["document"] == saved and restored["beforeDataUrl"] == before and restored["afterDataUrl"] == after
                assert len(client.get(path + "/image-history").json()["items"]) == 1
                generated = client.get(path + "/thumbnail")
                assert generated.headers["x-thumbnail-source"] == "generated"
                with Session(engine) as db:
                    stored_photo = json.loads(db.get(Garden, document["id"]).photo_json)
                    record = db.get(HistoryEntity, history["id"])
                    capture = db.get(GardenThumbnail, document["id"])
                    assert "dataUrl" not in stored_photo and stored_photo["imageMime"] == "image/jpeg"
                    assert record.before_png is None and record.after_png is None and capture.image_png is None
                    assert json.loads(record.snapshot_json)["photo"] == stored_photo
                    keys = {stored_photo["imageKey"], record.before_key, record.after_key, capture.image_key}
                    assert None not in keys
                for key in keys:
                    result = storage.get_object(Bucket=bucket, Key=key)
                    with result["Body"] as body:
                        content = body.read()
                    assert hashlib.sha256(content).hexdigest() == key.rsplit("/", 1)[1].split(".")[0]
                    assert result["ContentType"] == ("image/jpeg" if key.endswith(".jpg") else "image/png")
                    assert httpx.get(f"{endpoint}/{bucket}/{key}", timeout=5, trust_env=False).status_code == 403
                stop(api_process)
                stop(store_process)
                store_process = start(storage_command, store_env, store_log)
                ready(store_process, lambda: storage.head_bucket(Bucket=bucket)["ResponseMetadata"]["HTTPStatusCode"] == 200)
                api_process = start([sys.executable, "-m", "kusakari_canvas_api", "serve"], api_env, api_log)
                ready(api_process, lambda: client.get("/health/ready").is_success)
                assert client.get(path).json() == saved
                assert client.get(history_path).json() == restored
                assert client.get(path + "/thumbnail").content == generated.content
                assert client.get(f"/api/gardens/{legacy.id}").json() == legacy.model_dump(mode="json")
                assert client.delete(history_path).status_code == 204
                assert client.get(path + "/thumbnail").content == scene.content
                assert client.delete(path).status_code == 204
                for key in keys:
                    assert storage.head_object(Bucket=bucket, Key=key)["ResponseMetadata"]["HTTPStatusCode"] == 200
        report = {"result": "passed", "provider": "SeaweedFS 4.48 on loopback", "awsConnectionVerified": False,
                  "objectsVerified": len(keys), "checks": ["legacy DB photo mixed with S3 photos", "JPEG bytes roundtrip",
                  "PNG history and scene thumbnails", "DB contains keys, not image bytes", "object hashes and MIME types",
                  "anonymous reads rejected", "idempotent history retry", "API and storage restart restoration",
                  "history deletion restores scene capture", "garden deletion does not destroy shared objects"]}
        (output / "object-storage.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(json.dumps(report))
    finally:
        stop(api_process)
        stop(store_process)
        storage.close()
        for garden_id in owned_ids:
            with Session(engine) as db:
                exists = db.get(Garden, garden_id) is not None
            if exists:
                with Session(engine) as db:
                    delete_garden(db, settings.owner_id, garden_id)
        engine.dispose()
        for path in log_paths:
            if path.exists():
                path.write_text(path.read_text(errors="replace").replace(secret, "[local test secret]"), encoding="utf-8")


if __name__ == "__main__":
    main()
