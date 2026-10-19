"""Exercise the two shipping Linux images with isolated TLS MySQL and S3 fixtures."""
import argparse
import base64
import hashlib
import io
import json
import shutil
import subprocess
import time
from pathlib import Path
from uuid import uuid4

import httpx
from PIL import Image

from kusakari_canvas_api.ai_config import MODEL
from kusakari_canvas_api.config import REPO_ROOT
from verification.linux_fixture import LinuxFixture
from verification.verify_object_storage import image_url, photo


def media_roundtrip(fixture, client):
    created = client.post("/canvas/api/gardens", json={"name": "Linux S3 persistence fixture"})
    assert created.status_code == 201
    document = created.json()
    path = f"/canvas/api/gardens/{document['id']}"
    current, before, after = image_url("#b5bf91", "JPEG"), image_url("#8ea1ae"), image_url("#a8bc91")
    document["photo"] = photo(current)
    document["objects"] = [{"id": str(uuid4()), "assetId": "shrub_boxwood", "position": {"x": 0, "y": 0, "z": 0},
                            "rotation": {"x": 0, "y": 0, "z": 0}, "scale": {"x": 1, "y": 1, "z": 1}}]
    response = client.put(path, json=document)
    assert response.status_code == 200
    saved = response.json()
    assert saved["photo"]["dataUrl"] == current
    assert client.post(path + "/thumbnail", json={"revision": saved["revision"], "dataUrl": before}).status_code == 204
    history = {"id": str(uuid4()), "document": saved, "beforeDataUrl": before, "afterDataUrl": after,
               "model": MODEL, "quality": "medium", "generationMethod": "full_frame_v1", "inputImageCount": 2,
               "referenceSummary": [{"assetId": "shrub_boxwood", "productId": "linux-fixture",
                                     "productName": "Linux fixture", "source": "uploaded"}]}
    for _ in range(2):
        response = client.post(path + "/image-history", json=history)
        assert response.status_code == 200, f"History save rejected: {response.status_code} {response.text[:500]}"
    history_path = path + "/image-history/" + history["id"]
    restored = client.get(history_path).json()
    assert restored["document"] == saved and restored["afterDataUrl"] == after
    assert len(client.get(path + "/image-history").json()["items"]) == 1
    thumb = client.get(path + "/thumbnail")
    assert thumb.headers["x-thumbnail-source"] == "generated"
    # Thumbnails are intentionally decoded/re-encoded; compare pixels, not PNG compression or RGB/RGBA layout.
    with Image.open(io.BytesIO(thumb.content)) as thumbnail, Image.open(io.BytesIO(
            base64.b64decode(after.split(",", 1)[1]))) as expected:
        assert thumbnail.format == "PNG" and thumbnail.size == expected.size
        assert thumbnail.convert("RGB").tobytes() == expected.convert("RGB").tobytes()
    with fixture.db("kusakari_canvas_e2e") as db, db.cursor() as cursor:
        cursor.execute("SELECT photo_json FROM gardens WHERE id=%s", (saved["id"],))
        stored_photo = json.loads(cursor.fetchone()[0])
        assert "dataUrl" not in stored_photo and stored_photo["imageMime"] == "image/jpeg"
        cursor.execute("SELECT before_png,after_png,before_key,after_key,snapshot_json FROM garden_image_history WHERE id=%s",
                       (history["id"],))
        before_blob, after_blob, before_key, after_key, snapshot = cursor.fetchone()
        assert before_blob is None and after_blob is None
        assert json.loads(snapshot)["photo"] == stored_photo
        cursor.execute("SELECT image_png,image_key FROM garden_thumbnails WHERE garden_id=%s", (saved["id"],))
        thumbnail_blob, thumbnail_key = cursor.fetchone()
        assert thumbnail_blob is None
    keys = {stored_photo["imageKey"], before_key, after_key, thumbnail_key}
    assert None not in keys
    for key in keys:
        result = fixture.s3.get_object(Bucket=fixture.bucket, Key=key)
        with result["Body"] as body:
            content = body.read()
        assert hashlib.sha256(content).hexdigest() == key.rsplit("/", 1)[1].split(".")[0]
        assert result["ContentType"] == ("image/jpeg" if key.endswith(".jpg") else "image/png")
        url = f"http://127.0.0.1:{fixture.ports['s3']}/{fixture.bucket}/{key}"
        assert httpx.get(url, timeout=5, trust_env=False).status_code == 403
    return {"path": path, "document": saved, "historyPath": history_path, "history": restored,
            "thumbnailSha256": hashlib.sha256(thumb.content).hexdigest(), "objectCount": len(keys)}


def hardening(fixture, role, name):
    detail = fixture.inspect(name)
    assert detail["Config"]["User"] == "10001:10001"
    assert detail["HostConfig"]["ReadonlyRootfs"] is True
    temporary = next(mount for mount in detail["Mounts"] if mount["Destination"] == "/tmp")
    assert temporary["Type"] == "volume" and temporary["RW"]
    probe = ('test "$(id -u)" = 10001 && test "$(stat -c %u /tmp)" = 10001 && '
             'touch /tmp/verification-write && ! touch /app/verification-forbidden 2>/dev/null && '
             'test ! -e /app/.env && test ! -e /app/backend/.env && test ! -d /root/.aws')
    fixture.docker("exec", name, "sh", "-c", probe)
    ca = "/app/certs/rds.p12" if role == "ec" else "/app/certs/rds-global-bundle.pem"
    fixture.docker("exec", name, "test", "-s", ca)
    image = fixture.inspect_image(fixture.images[role])
    forbidden = {"OPENAI_API_KEY", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "KUSAKARI_EC_DB_PASSWORD",
                 "KUSAKARI_CANVAS_DB_PASSWORD"}
    assert not any(entry.split("=", 1)[0] in forbidden for entry in image["Config"]["Env"])
    return {"role": role, "imageId": image["Id"], "user": detail["Config"]["User"],
            "readonlyRoot": True, "tmpOwnedAndWritable": True, "rdsTrustStorePresent": True}


def browser(fixture, ec_root, site, output):
    env = {**fixture.env, "KUSAKARI_LINUX_VERIFICATION": "true", "KUSAKARI_DEPLOY_SITE": str(site),
           "NODE_OPTIONS": "--max-old-space-size=384 --max-semi-space-size=8",
           "KUSAKARI_DEPLOY_ARTIFACTS": str(output), "KUSAKARI_DEPLOY_PREVIEW_PORT": str(fixture.ports["web"]),
           "KUSAKARI_EC_PREVIEW_API": f"http://127.0.0.1:{fixture.ports['ec']}",
           "KUSAKARI_CANVAS_PREVIEW_API": f"http://127.0.0.1:{fixture.ports['canvas']}"}
    command = [shutil.which("node"), str(ec_root / "node_modules/@playwright/test/cli.js"),
               "test", "--config", "playwright.linux.config.js"]
    with (output / "browser.log").open("wb") as log:
        result = subprocess.run(command, cwd=ec_root, env=env, stdout=log, stderr=subprocess.STDOUT,
                                timeout=240, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    assert result.returncode == 0, f"Linux browser test failed; inspect {output / 'browser.log'}"
    report = json.loads((output / "browser-report.json").read_text(encoding="utf-8"))
    assert report["stats"]["expected"] == 1 and report["stats"]["unexpected"] == 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--canvas-image", required=True)
    parser.add_argument("--ec-image", required=True)
    parser.add_argument("--mysql-image", default="mysql:8.4")
    parser.add_argument("--storage-image", default="chrislusf/seaweedfs:4.48")
    parser.add_argument("--site", type=Path, required=True)
    parser.add_argument("--ec-root", type=Path, default=REPO_ROOT.parent / "kusakari-ec")
    parser.add_argument("--work-root", type=Path,
                        help="Existing directory for isolated DB/S3 files, logs, browser temp and evidence; "
                             "system-drive and Docker-storage headroom are still required")
    args = parser.parse_args()
    site, ec_root = args.site.resolve(strict=True), args.ec_root.resolve(strict=True)
    fixture = LinuxFixture({"canvas": args.canvas_image, "ec": args.ec_image,
                            "mysql": args.mysql_image, "storage": args.storage_image}, work_root=args.work_root)
    output = (fixture.root / "evidence" if fixture.external_storage
              else REPO_ROOT / "artifacts/deployment-refactor" / fixture.id)
    output.mkdir(parents=True, exist_ok=False)
    report = {"result": "failed", "awsConnectionVerified": False, "runId": fixture.id,
              "diagnostics": str(fixture.root), "evidence": str(output), "checks": []}

    def passed(name, **details):
        report["checks"].append({"name": name, "passed": True, **details})
        print("PASS: " + name, flush=True)

    try:
        print(f"Preparing isolated Linux fixtures: {fixture.id}", flush=True)
        fixture.prepare()
        with fixture.db() as db, db.cursor() as cursor:
            cursor.execute("SELECT VERSION()")
            report["mysqlVersion"] = cursor.fetchone()[0]
        passed("isolated TLS-only MySQL and authenticated S3 ready")
        for role, schema in (("canvas", "kusakari_canvas_e2e"), ("ec", "kusakari_e2e")):
            uninitialized = fixture.api(role, role + "-uninitialized")
            fixture.wait_exit(uninitialized, 3 if role == "canvas" else 1)
            with fixture.db() as db, db.cursor() as cursor:
                cursor.execute("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=%s", (schema,))
                assert cursor.fetchone()[0] == 0, "Normal startup changed the unmigrated database"
            passed(role + " refuses an uninitialized database without creating tables")
            for attempt in ("first", "repeat"):
                migration = fixture.api(role, role + "-migrate-" + attempt, ["migrate"])
                fixture.wait_exit(migration)
            passed(role + " explicit migration and repeat are successful")
        canvas = fixture.api("canvas", "canvas", ports=True)
        fixture.api_ready("canvas", canvas)
        ec = fixture.api("ec", "ec", network="container:" + canvas)
        fixture.api_ready("ec", ec)
        assert fixture.inspect(ec)["HostConfig"]["NetworkMode"] == "container:" + fixture.inspect(canvas)["Id"]
        passed("two APIs share the task-style loopback network")
        for role, name in (("canvas", canvas), ("ec", ec)):
            passed(role + " image runs nonroot with readonly root and writable tmp", **hardening(fixture, role, name))
        with httpx.Client(base_url=f"http://127.0.0.1:{fixture.ports['canvas']}",
                          headers={"Origin": fixture.origin}, timeout=30, trust_env=False) as client:
            persisted = media_roundtrip(fixture, client)
            passed("S3 photo/history/thumbnail bytes and DB references match", objectCount=persisted["objectCount"])
            products_url = f"http://127.0.0.1:{fixture.ports['ec']}/api/products?storeId=1"
            products = httpx.get(products_url, timeout=30, trust_env=False).json()
            for name in (ec, canvas):
                started = time.monotonic()
                state = fixture.stop(name)
                assert state["ExitCode"] in {0, 143} and not state["OOMKilled"], state["ExitCode"]
                passed(name.rsplit("-", 1)[1] + " SIGTERM completes without forced kill",
                       exitCode=state["ExitCode"], elapsedSeconds=round(time.monotonic() - started, 2))
            fixture.stop(fixture.storage)
            fixture.stop(fixture.database)
            fixture.docker("start", fixture.database, fixture.storage)
            fixture.wait(fixture.database, lambda: fixture.db().close() is None)
            fixture.wait(fixture.storage, lambda: fixture.s3.head_bucket(Bucket=fixture.bucket)["ResponseMetadata"]["HTTPStatusCode"] == 200)
            fixture.docker("start", canvas)
            fixture.api_ready("canvas", canvas)
            fixture.docker("start", ec)
            fixture.api_ready("ec", ec)
            assert client.get(persisted["path"]).json() == persisted["document"]
            assert client.get(persisted["historyPath"]).json() == persisted["history"]
            thumb = client.get(persisted["path"] + "/thumbnail")
            assert hashlib.sha256(thumb.content).hexdigest() == persisted["thumbnailSha256"]
            assert httpx.get(products_url, timeout=30, trust_env=False).json() == products
            passed("API/database/storage restart preserves exact product, garden and image data")
            browser(fixture, ec_root, site, output)
            passed("Chromium packaged-site model/cart/photo/reload workflow uses Linux APIs")
        report["result"] = "passed"
    except Exception as error:
        report["failure"] = type(error).__name__ + ": " + fixture.redact(str(error))
        raise
    finally:
        failures = fixture.close()
        report["cleanupFailures"] = failures
        report["ownedContainersStopped"] = not failures
        report["retainedContainers"] = fixture.owned
        report["retainedVolumes"] = fixture.volumes
        report["retainedHostData"] = fixture.host_data
        report["hostTemporaryDirectory"] = fixture.env.get("TMPDIR") if fixture.external_storage else None
        report["retainedNetwork"] = fixture.network
        if failures:
            report["result"] = "failed"
        (output / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(json.dumps({"result": report["result"], "report": str(output / "report.json")}), flush=True)
    if failures:
        raise RuntimeError(f"Verification cleanup failed; inspect {output / 'report.json'}")


if __name__ == "__main__":
    main()
