from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class PlantModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class PlantProfile(PlantModel):
    botanicalForm: Literal["maple", "monstera", "iberis", "hakone", "goldcrest"] | None = None
    plantType: Literal["tree", "shrub", "flower", "conifer", "multistem", "spreading", "grass", "rosette", "vine", "palm"]
    heightCm: float = Field(ge=10, le=1500)
    widthCm: float = Field(ge=10, le=1000)
    crownShape: Literal["round", "conical", "spreading"] = "round"
    branchCount: int = Field(default=12, ge=3, le=24)
    branchAngle: float = Field(default=45, ge=15, le=80)
    trunkThicknessCm: float = Field(default=8, ge=0.2, le=100)
    leafShape: Literal["oval", "narrow", "needle", "scale", "round", "heart", "palmate", "split", "compound", "succulent", "grass", "frond"] = "oval"
    leafSizeCm: float = Field(default=12, ge=2, le=80)
    leafDensity: Literal["low", "medium", "high"] = "medium"
    leafColor: str = Field(default="#4f793b", pattern=r"^#[0-9a-fA-F]{6}$")
    flowerEnabled: bool = False
    flowerShape: Literal["four", "five", "eight", "spike", "cluster", "daisy", "bell", "plume"] = "five"
    flowerSizeCm: float = Field(default=10, ge=0.3, le=60)
    flowerColor: str = Field(default="#df7799", pattern=r"^#[0-9a-fA-F]{6}$")
    seed: int = Field(default=12345, ge=0, le=2147483647)

    @model_validator(mode="after")
    def compatible_features(self):
        allowed = {"conifer": {"needle", "scale"}, "grass": {"grass"}, "palm": {"frond"},
                   "rosette": {"succulent", "narrow", "oval"},
                   "vine": {"oval", "round", "heart", "palmate", "split", "compound"}}
        if self.plantType in allowed and self.leafShape not in allowed[self.plantType]:
            raise ValueError("Leaf shape is incompatible with the plant architecture")
        if self.plantType in ("conifer", "palm") and self.flowerEnabled:
            raise ValueError("Flowers are not supported for this plant architecture")
        forms = {"maple": ("tree", "palmate"), "monstera": ("flower", "split"),
                 "iberis": ("spreading", "narrow"), "hakone": ("grass", "grass"),
                 "goldcrest": ("conifer", "scale")}
        if self.botanicalForm and (self.plantType, self.leafShape) != forms[self.botanicalForm]:
            raise ValueError("植物別の組立規則と植物タイプ・葉の形が一致しません。")
        if self.botanicalForm == "iberis" and self.flowerEnabled and self.flowerShape != "four":
            raise ValueError("イベリスの花弁は4枚で指定してください。")
        if self.botanicalForm in ("maple", "monstera") and self.flowerEnabled:
            raise ValueError("この植物別モデルは葉姿のみを扱います。花を付ける場合は汎用設定を使用してください。")
        return self


class ModelPart(PlantModel):
    partId: Literal["stem", "stem-wood", "stem-herb", "stem-cane", "stem-palm", "stem-vine", "stem-arching",
                    "leaf-oval", "leaf-narrow", "leaf-needle", "leaf-scale", "leaf-round", "leaf-heart", "leaf-palmate",
                    "leaf-split", "leaf-compound", "leaf-succulent", "leaf-grass", "leaf-frond", "leaf-iberis", "flower-iberis",
                    "flower-four", "flower-five", "flower-eight", "flower-spike", "flower-cluster", "flower-daisy", "flower-bell", "flower-plume",
                    "stem-natural", "stem-petiole", "leaf-maple", "leaf-maple-curl", "leaf-monstera", "leaf-monstera-young",
                    "leaf-hakone", "leaf-hakone-curl", "leaf-goldcrest", "leaf-iberis-v4", "flower-iberis-v4"]
    position: tuple[float, float, float]
    quaternion: tuple[float, float, float, float]
    scale: tuple[float, float, float]
    color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")


class ModelDimensions(PlantModel):
    width: float = Field(gt=0, le=30)
    height: float = Field(gt=0, le=30)
    depth: float = Field(gt=0, le=30)


class PlantComposition(PlantModel):
    version: Literal[1, 2, 3, 4] = 1
    catalogVersion: Literal[1, 2, 3, 4] = 1
    profile: PlantProfile
    baseDimensions: ModelDimensions
    fitScale: tuple[float, float, float] = (1, 1, 1)
    parts: list[ModelPart] = Field(min_length=1, max_length=1500)
