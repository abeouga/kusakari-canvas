"""Private, content-addressed image storage. API DTOs remain backward compatible.

Object keys are server-generated, never accepted from a request or a signed URL.
Deleting DB rows does not delete shared image objects; retention is an operator task.
"""
import base64
import hashlib
import json
import os
import re

from .errors import ApiError


class MediaStore:
    def __init__(self):
        mode = os.environ.get("KUSAKARI_CANVAS_MEDIA_STORAGE", "database")
        if mode not in {"database", "s3"}:
            raise ValueError("KUSAKARI_CANVAS_MEDIA_STORAGE must be database or s3.")
        self.external = mode == "s3"
        self.client = None
        self.bucket = os.environ.get("KUSAKARI_CANVAS_MEDIA_BUCKET", "")
        self.prefix = os.environ.get("KUSAKARI_CANVAS_MEDIA_PREFIX", "canvas-media/v1").strip("/")
        if not re.fullmatch(r"[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*", self.prefix):
            raise ValueError("Invalid media key prefix.")
        if self.external:
            import boto3
            from botocore.config import Config
            if not self.bucket:
                raise ValueError("KUSAKARI_CANVAS_MEDIA_BUCKET is required for S3 storage.")
            self.client = boto3.client("s3", endpoint_url=os.environ.get("KUSAKARI_CANVAS_S3_ENDPOINT"),
                                      config=Config(connect_timeout=3, read_timeout=15,
                                                    retries={"max_attempts": 2, "mode": "standard"},
                                                    s3={"addressing_style": "path"}))

    def put(self, content: bytes, mime: str = "image/png") -> tuple[bytes | None, str | None]:
        if not self.external:
            return content, None
        suffix = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}[mime]
        key = f"{self.prefix}/{hashlib.sha256(content).hexdigest()}.{suffix}"
        try:
            # Use the task role / SDK credential chain; never a public-read ACL.
            self.client.put_object(Bucket=self.bucket, Key=key, Body=content, ContentType=mime)
        except Exception:
            raise ApiError(503, "MEDIA_UNAVAILABLE", "画像の保存先へ接続できません。再試行してください。") from None
        return None, key

    def get(self, content: bytes | None, key: str | None) -> bytes:
        if key is None:
            if content is None:
                raise ApiError(500, "MEDIA_MISSING", "保存された画像が見つかりません。")
            return content
        if not self.client or not re.fullmatch(re.escape(self.prefix) + r"/[a-f0-9]{64}\.(png|jpg|webp)", key):
            raise ApiError(503, "MEDIA_UNAVAILABLE", "画像の保存先設定を確認してください。")
        try:
            response = self.client.get_object(Bucket=self.bucket, Key=key)
            with response["Body"] as body:
                content = body.read(30_000_001)
            if len(content) > 30_000_000 or hashlib.sha256(content).hexdigest() != key.rsplit("/", 1)[1].split(".")[0]:
                raise ValueError("Image integrity check failed.")
            return content
        except Exception:
            raise ApiError(503, "MEDIA_UNAVAILABLE", "保存画像を取得できません。再試行してください。") from None

    def store_photo(self, photo: dict | None) -> dict | None:
        if photo is None or not self.external:
            return photo
        photo = dict(photo)
        prefix, _, encoded = photo.pop("dataUrl").partition(",")
        mime = prefix.removeprefix("data:").removesuffix(";base64")
        _, key = self.put(base64.b64decode(encoded, validate=True), mime)
        photo["imageKey"] = key
        photo["imageMime"] = mime
        return photo

    def load_photo(self, photo: dict | None) -> dict | None:
        if photo is None or "imageKey" not in photo:
            return photo
        photo = dict(photo)
        image = self.get(None, photo.pop("imageKey"))
        mime = photo.pop("imageMime")
        photo["dataUrl"] = f"data:{mime};base64," + base64.b64encode(image).decode("ascii")
        return photo

    def store_document(self, value: str) -> str:
        document = json.loads(value)
        document["photo"] = self.store_photo(document.get("photo"))
        return json.dumps(document, ensure_ascii=False, separators=(",", ":"))

    def load_document(self, value: str) -> dict:
        document = json.loads(value)
        document["photo"] = self.load_photo(document.get("photo"))
        return document

    def close(self):
        if self.client:
            self.client.close()
