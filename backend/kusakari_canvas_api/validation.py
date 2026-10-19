import base64
import io
import math
from uuid import UUID

import cv2
import numpy as np
from PIL import Image

from .calibration import validate_calibrated_photo
from .errors import bad_request
from .plant_assembly import assemble
from .schemas import GardenDocumentRequest, GardenPhoto, ImagePoint


def validate_document(document: GardenDocumentRequest) -> None:
    ids: set[str] = set()
    for obj in document.objects:
        if obj.assetId == "plant_modular":
            if not obj.productId or not obj.productName or obj.materialCode != f"product.{obj.productId}" \
                    or obj.modelComposition is None:
                bad_request("INVALID_PLANT_MODEL", "商品の植物構成が不足しています。商品から配置し直してください。")
            try:
                expected = assemble(obj.modelComposition.profile, obj.modelComposition.version)
            except ValueError:
                bad_request("INVALID_PLANT_MODEL", "植物の特徴と構成の版が一致しません。")
            if expected != obj.modelComposition:
                bad_request("INVALID_PLANT_MODEL", "保存された植物の部品構成が不正です。")
        elif any(value is not None for value in (obj.productId, obj.productName, obj.materialCode, obj.modelComposition)):
            bad_request("INVALID_PLANT_MODEL", "固定アセットに植物構成を指定できません。")
        try:
            canonical = str(UUID(obj.id))
            if canonical != obj.id.lower():
                raise ValueError()
        except ValueError:
            bad_request("INVALID_OBJECT_ID", "配置オブジェクトのIDはUUID形式で指定してください。")
        if canonical in ids:
            bad_request("DUPLICATE_OBJECT_ID", "配置オブジェクトのIDが重複しています。")
        ids.add(canonical)
        p, r, s = obj.position, obj.rotation, obj.scale
        if any(not math.isfinite(v) for vector in (p, r, s) for v in (vector.x, vector.y, vector.z)):
            bad_request("NON_FINITE_NUMBER", "座標、回転、倍率には有限の数値を指定してください。")
        if p.y != 0 or not -document.width / 2 <= p.x <= document.width / 2 \
                or not -document.depth / 2 <= p.z <= document.depth / 2:
            bad_request("OBJECT_POSITION_OUT_OF_BOUNDS", "配置位置は庭の範囲内でY=0にしてください。")
        if r.x != 0 or r.z != 0:
            bad_request("INVALID_OBJECT_ROTATION", "オブジェクトはY軸回りだけ回転できます。")
        if not 0.25 <= s.x <= 3 or s.x != s.y or s.x != s.z:
            bad_request("INVALID_OBJECT_SCALE", "倍率は0.25〜3.0の一様な値にしてください。")
    if document.photo is not None:
        validate_photo(document.photo)
        validate_calibrated_photo(document.photo, document.width, document.depth)
        validate_projection_frame(document.photo, document.width, document.depth)


def validate_projection_frame(photo: GardenPhoto, width: float, depth: float) -> None:
    frame = photo.projectionSize
    if frame is None or photo.calibration is not None:
        return
    source = np.array([[p.x, p.y] for p in photo.corners], dtype=np.float32)
    target = np.array([[-frame.width / 2, frame.depth / 2], [frame.width / 2, frame.depth / 2],
                       [frame.width / 2, -frame.depth / 2], [-frame.width / 2, -frame.depth / 2]], dtype=np.float32)
    transform = cv2.getPerspectiveTransform(source, target)
    for p in photo.boundary:
        mapped = transform @ np.array([p.x, p.y, 1])
        if abs(mapped[2]) < 1e-8:
            bad_request('INVALID_PHOTO_BOUNDARY', '輪郭を地面上に指定してください。')
        x, z = mapped[:2] / mapped[2]
        if abs(x) > width / 2 + 0.05 or abs(z) > depth / 2 + 0.05:
            bad_request('INVALID_PHOTO_BOUNDARY', '輪郭が土台の実寸範囲を超えています。')


def orientation(a: ImagePoint, b: ImagePoint, c: ImagePoint) -> float:
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)


def on_segment(a: ImagePoint, b: ImagePoint, point: ImagePoint) -> bool:
    return abs(orientation(a, b, point)) < 1e-9 \
        and min(a.x, b.x) - 1e-9 <= point.x <= max(a.x, b.x) + 1e-9 \
        and min(a.y, b.y) - 1e-9 <= point.y <= max(a.y, b.y) + 1e-9


def segments_cross(a: ImagePoint, b: ImagePoint, c: ImagePoint, d: ImagePoint) -> bool:
    return (orientation(a, b, c) * orientation(a, b, d) < 0
            and orientation(c, d, a) * orientation(c, d, b) < 0) \
        or on_segment(a, b, c) or on_segment(a, b, d) or on_segment(c, d, a) or on_segment(c, d, b)


def image_point_valid(p: ImagePoint) -> bool:
    return math.isfinite(p.x) and math.isfinite(p.y) and 0 <= p.x <= 1 and 0 <= p.y <= 1


def validate_photo(photo: GardenPhoto) -> None:
    if not 1 <= photo.imageWidth <= 6000 or not 1 <= photo.imageHeight <= 6000 \
            or photo.imageWidth * photo.imageHeight > 25_000_000 \
            or len(photo.corners) != 4 or not 3 <= len(photo.boundary) <= 64:
        bad_request("INVALID_PHOTO", "写真または四隅の形式が不正です。")
    prefixes = ("data:image/jpeg;base64,", "data:image/png;base64,")
    prefix = next((p for p in prefixes if photo.dataUrl.startswith(p)), None)
    if prefix is None or len(photo.dataUrl) > 8_000_000:
        bad_request("INVALID_PHOTO", "JPEGまたはPNGの写真を5MB以内で指定してください。")
    try:
        content = base64.b64decode(photo.dataUrl[len(prefix):], validate=True)
        if not 0 < len(content) <= 5_000_000:
            raise ValueError()
        with Image.open(io.BytesIO(content)) as image:
            if image.format not in {"JPEG", "PNG"} or image.size != (photo.imageWidth, photo.imageHeight):
                raise ValueError()
            image.load()
    except (ValueError, OSError, Image.DecompressionBombError):
        bad_request("INVALID_PHOTO", "写真データまたは画像寸法が不正です。")
    sign = 0
    for i, a in enumerate(photo.corners):
        b, c = photo.corners[(i + 1) % 4], photo.corners[(i + 2) % 4]
        if not image_point_valid(a):
            bad_request("INVALID_PHOTO_CORNERS", "四隅は画像内の正規化座標で指定してください。")
        cross = orientation(a, b, c)
        next_sign = 1 if cross > 0 else -1
        if abs(cross) < 0.0001 or (sign and sign != next_sign):
            bad_request("INVALID_PHOTO_CORNERS", "四隅の順序または形状が不正です。")
        sign = next_sign
    if sign >= 0:
        bad_request("INVALID_PHOTO_CORNERS", "手前左から時計回りに指定してください。")
    for point in photo.boundary:
        if not image_point_valid(point):
            bad_request("INVALID_PHOTO_BOUNDARY", "輪郭点は画像内に指定してください。")
        if not photo.calibration and not photo.projectionSize and any(orientation(a, photo.corners[(i + 1) % 4], point) > 0.000001
               for i, a in enumerate(photo.corners)):
            bad_request("INVALID_PHOTO_BOUNDARY", "輪郭点は四隅の内側に指定してください。")
    area = 0.0
    size = len(photo.boundary)
    for i, a in enumerate(photo.boundary):
        b = photo.boundary[(i + 1) % size]
        if math.hypot(a.x - b.x, a.y - b.y) < 0.001:
            bad_request("INVALID_PHOTO_BOUNDARY", "輪郭点が近すぎます。")
        area += a.x * b.y - b.x * a.y
        for j in range(i + 1, size):
            if j == i + 1 or (i == 0 and j == size - 1):
                continue
            if segments_cross(a, b, photo.boundary[j], photo.boundary[(j + 1) % size]):
                bad_request("INVALID_PHOTO_BOUNDARY", "輪郭線が交差しています。")
    if abs(area) < 0.0002:
        bad_request("INVALID_PHOTO_BOUNDARY", "輪郭の面積が小さすぎます。")
