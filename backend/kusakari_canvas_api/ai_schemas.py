from typing import Literal
from uuid import UUID

from pydantic import Field

from .ai_config import MAX_DATA_URL_LENGTH
from .schemas import ApiModel, GardenDocumentRequest

GenerationMethod = Literal["masked_composite_v1", "full_frame_v1", "full_frame_v2", "full_frame_v3"]


class PixelPoint(ApiModel):
    x: float = Field(ge=-1_000_000, le=1_000_000)
    y: float = Field(ge=-1_000_000, le=1_000_000)


class PixelBounds(ApiModel):
    x: int = Field(ge=0, le=2048, strict=True)
    y: int = Field(ge=0, le=2048, strict=True)
    width: int = Field(ge=1, le=2048, strict=True)
    height: int = Field(ge=1, le=2048, strict=True)


class LayoutPlacement(ApiModel):
    placementId: UUID
    assetId: str = Field(min_length=1, max_length=64)
    anchor: PixelPoint | None
    bounds: PixelBounds | None
    visibleBounds: PixelBounds | None
    visibility: Literal["visible", "partial", "full", "outside", "unknown"]
    measurement: Literal["raster", "projected_box"]


class ReferenceRequest(ApiModel):
    assetId: str = Field(min_length=1, max_length=64)
    productId: str = Field(min_length=1, max_length=100)
    photoDataUrl: str | None = Field(default=None, max_length=MAX_DATA_URL_LENGTH, repr=False)


class AiImageRequest(ApiModel):
    generationId: UUID | None = None
    document: GardenDocumentRequest = Field(repr=False)
    beforeDataUrl: str = Field(max_length=MAX_DATA_URL_LENGTH, repr=False)
    coverageDataUrl: str = Field(max_length=MAX_DATA_URL_LENGTH, repr=False)
    layout: list[LayoutPlacement] = Field(min_length=1, max_length=200, repr=False)
    storeId: int = Field(gt=0)
    references: list[ReferenceRequest] = Field(min_length=1, max_length=15, repr=False)


class AiStatus(ApiModel):
    configured: bool
    model: str
    quality: str


class AiStore(ApiModel):
    id: int = Field(gt=0)
    name: str = Field(min_length=1, max_length=250)
    address: str | None = Field(default=None, max_length=1000)


class AiCandidate(ApiModel):
    assetId: str
    productId: str
    productName: str
    imageUrl: str
    source: Literal["catalog"] = "catalog"
    requiresUpload: bool
    active: bool = True


class ProductReferencesRequest(ApiModel):
    productIds: list[str] = Field(min_length=1, max_length=200)


class ReferenceSummary(ApiModel):
    assetId: str = Field(min_length=1, max_length=64)
    productId: str = Field(min_length=1, max_length=100)
    productName: str = Field(min_length=1, max_length=250)
    source: Literal["catalog", "uploaded"]


class AiImageResponse(ApiModel):
    dataUrl: str = Field(repr=False)
    width: int
    height: int
    model: str
    quality: str
    generationMethod: GenerationMethod
    inputImageCount: int
    referenceSummary: list[ReferenceSummary]
    historyId: str
    historySaved: bool
    historyError: str | None = None
