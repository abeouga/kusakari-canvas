from datetime import datetime
from uuid import UUID

from pydantic import Field, field_validator

from .ai_config import MAX_AFTER_DATA_URL_LENGTH, MAX_DATA_URL_LENGTH, MODEL, SUPPORTED_QUALITIES
from .ai_schemas import GenerationMethod, ReferenceSummary
from .schemas import ApiModel, GardenDocumentRequest


class HistorySaveRequest(ApiModel):
    id: UUID
    document: GardenDocumentRequest = Field(repr=False)
    beforeDataUrl: str = Field(max_length=MAX_DATA_URL_LENGTH, repr=False)
    afterDataUrl: str = Field(max_length=MAX_AFTER_DATA_URL_LENGTH, repr=False)
    model: str
    quality: str
    generationMethod: GenerationMethod
    inputImageCount: int = Field(ge=2, le=16, strict=True)
    referenceSummary: list[ReferenceSummary] = Field(min_length=1, max_length=15)

    @field_validator("model")
    @classmethod
    def supported_model(cls, value: str) -> str:
        if value != MODEL:
            raise ValueError("unsupported generation model")
        return value

    @field_validator("quality")
    @classmethod
    def supported_quality(cls, value: str) -> str:
        if value not in SUPPORTED_QUALITIES:
            raise ValueError("unsupported generation quality")
        return value


class HistorySummary(ApiModel):
    id: str
    createdAt: datetime
    width: int
    height: int
    model: str
    quality: str
    generationMethod: GenerationMethod
    inputImageCount: int
    referenceSummary: list[ReferenceSummary]
    snapshotRevision: int


class HistoryPage(ApiModel):
    items: list[HistorySummary]
    nextCursor: str | None


class HistoryDetail(HistorySummary):
    beforeDataUrl: str = Field(repr=False)
    afterDataUrl: str = Field(repr=False)
    document: GardenDocumentRequest = Field(repr=False)
