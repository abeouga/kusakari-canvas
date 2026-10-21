from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .plant_schemas import PlantComposition


class ApiModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class NamedRequest(ApiModel):
    name: str = Field(min_length=1)
    width: float = Field(ge=1, le=50)
    depth: float = Field(ge=1, le=50)

    @field_validator("name")
    @classmethod
    def valid_name(cls, value: str) -> str:
        if not value.strip() or len(value.encode("utf-16-le")) // 2 > 120:
            raise ValueError("invalid name")
        return value


class CreateGardenRequest(NamedRequest):
    width: float = Field(default=10, ge=1, le=50)
    depth: float = Field(default=8, ge=1, le=50)


class Vector(ApiModel):
    x: float
    y: float
    z: float


class GardenObject(ApiModel):
    id: str = Field(min_length=1)
    assetId: str = Field(min_length=1)
    position: Vector
    rotation: Vector
    scale: Vector
    productId: str | None = Field(default=None, max_length=40, pattern=r"^[a-z0-9][a-z0-9-]*$", exclude_if=lambda value: value is None)
    productName: str | None = Field(default=None, min_length=1, max_length=120, exclude_if=lambda value: value is None)
    materialCode: str | None = Field(default=None, max_length=80, exclude_if=lambda value: value is None)
    modelComposition: PlantComposition | None = Field(default=None, exclude_if=lambda value: value is None)

    @field_validator("id", "assetId")
    @classmethod
    def nonblank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("blank value")
        return value


class ImagePoint(ApiModel):
    x: float
    y: float


class CalibrationRequest(ApiModel):
    imageWidth: int = Field(ge=1, le=6000)
    imageHeight: int = Field(ge=1, le=6000)
    points: list[ImagePoint] = Field(min_length=4, max_length=4)
    referenceWidth: float = Field(ge=0.1, le=50)
    referenceDepth: float = Field(ge=0.1, le=50)
    focalLengthPx: float | None = Field(default=None, gt=0, le=100000)


def _absent(value) -> bool:
    return value is None


class PhotoCalibration(ApiModel):
    """A camera from a reference rectangle, or ('edges') from the outline and GardenPhoto.edgeLengths."""
    version: Literal[1] = 1
    method: Literal['rectangle', 'edges'] = Field(default='rectangle', exclude_if=lambda value: value == 'rectangle')
    points: Annotated[list[ImagePoint], Field(min_length=4, max_length=4)] | None = Field(default=None, exclude_if=_absent)
    referenceWidth: float | None = Field(default=None, ge=0.1, le=50, exclude_if=_absent)
    referenceDepth: float | None = Field(default=None, ge=0.1, le=50, exclude_if=_absent)
    focalLengthPx: float = Field(gt=0, le=100000)
    focalSource: Literal['estimated', 'manual']
    rotation: list[float] = Field(min_length=9, max_length=9)
    translation: list[float] = Field(min_length=3, max_length=3)
    reprojectionErrorPx: float = Field(ge=0)

    @model_validator(mode="after")
    def single_reference(self):
        rectangle = [self.points, self.referenceWidth, self.referenceDepth]
        if self.method == 'rectangle' and any(_absent(value) for value in rectangle):
            raise ValueError("rectangle calibration requires points and reference size")
        if self.method == 'edges' and any(not _absent(value) for value in rectangle):
            raise ValueError("edge calibration cannot include a reference rectangle")
        return self


class PhotoProjectionSize(ApiModel):
    width: float = Field(ge=1, le=50)
    depth: float = Field(ge=1, le=50)


class GardenPhoto(ApiModel):
    dataUrl: str
    imageWidth: int
    imageHeight: int
    corners: list[ImagePoint]
    boundary: list[ImagePoint]
    # Absent optional extensions must not change the JSON shape of legacy photos.
    calibration: PhotoCalibration | None = Field(default=None, exclude_if=lambda value: value is None)
    # Measured length per boundary edge (boundary[i] -> boundary[i + 1]); null until entered.
    edgeLengths: Annotated[list[Annotated[float, Field(ge=0.01, le=100)] | None], Field(min_length=3, max_length=64)] | None =         Field(default=None, exclude_if=lambda value: value is None)
    projectionSize: PhotoProjectionSize | None = Field(default=None, exclude_if=lambda value: value is None)


class GardenDocumentRequest(NamedRequest):
    schemaVersion: int = Field(ge=1, le=1)
    id: str = Field(min_length=1)
    revision: int = Field(ge=0, le=9223372036854775807)
    objects: list[GardenObject] = Field(max_length=200)
    photo: GardenPhoto | None = None


class GardenDocument(ApiModel):
    schemaVersion: int = 1
    id: str
    revision: int
    name: str
    width: float
    depth: float
    objects: list[GardenObject]
    photo: GardenPhoto | None


class GardenSummary(ApiModel):
    id: str
    name: str
    width: float
    depth: float
    revision: int
    updatedAt: datetime


class BaseDimensions(ApiModel):
    width: float
    height: float
    depth: float


class AssetResponse(ApiModel):
    id: str
    name: str
    category: str
    modelUrl: str
    baseDimensions: BaseDimensions
