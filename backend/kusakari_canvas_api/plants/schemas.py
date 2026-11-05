"""v5 plant profile and composition. Units are cm in the profile and metres in the composition."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .species import FLOWERLESS_TYPES, LEAF_SHAPES_BY_TYPE, SPECIES

PlantType = Literal["tree", "shrub", "flower", "conifer", "multistem", "spreading", "grass", "rosette", "vine", "palm"]
LeafShape = Literal["oval", "narrow", "needle", "scale", "round", "heart", "palmate", "split", "compound",
                    "succulent", "grass", "frond"]
FlowerShape = Literal["four", "five", "eight", "spike", "cluster", "daisy", "bell", "plume"]
Species = Literal["maple", "monstera", "iberis", "hakone", "goldcrest", "olive", "lavender", "rose",
                  "hydrangea", "boxwood", "hosta"]
PartId = Literal["stem-natural", "stem-petiole", "stem-palm",
                 "leaf-oval", "leaf-narrow", "leaf-needle", "leaf-scale", "leaf-round", "leaf-heart",
                 "leaf-palmate", "leaf-split", "leaf-compound", "leaf-succulent", "leaf-grass", "leaf-frond",
                 "leaf-maple", "leaf-maple-curl", "leaf-monstera", "leaf-monstera-young", "leaf-hakone",
                 "leaf-hakone-curl", "leaf-goldcrest", "leaf-iberis-v4",
                 "flower-four", "flower-five", "flower-eight", "flower-spike", "flower-cluster", "flower-daisy",
                 "flower-bell", "flower-plume", "flower-iberis-v4"]
COLOR = r"^#[0-9a-fA-F]{6}$"


class PlantModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class PlantProfile(PlantModel):
    """Seller-facing features. Shape fields left as null use the plant type / species defaults."""

    botanicalForm: Species | None = None
    plantType: PlantType
    heightCm: float = Field(ge=10, le=1500)
    widthCm: float = Field(ge=10, le=1000)
    crownShape: Literal["round", "conical", "spreading"] = "round"
    # Stems: main stems from the ground, their bend and how much they thin towards the tip.
    stemCount: int | None = Field(default=None, ge=1, le=12)
    stemCurve: float | None = Field(default=None, ge=0, le=1)
    stemTaper: float | None = Field(default=None, ge=0, le=1)
    trunkThicknessCm: float = Field(default=8, ge=0.2, le=100)
    # Branches: count over the whole plant, angle from vertical, side-shoot length relative to the parent
    # branch, orders, droop, first branch height. The overall reach is the plant width.
    branchCount: int = Field(default=12, ge=3, le=24)
    branchAngle: float = Field(default=45, ge=15, le=80)
    twigLength: float | None = Field(default=None, ge=0.3, le=1.5)
    branchLevels: int | None = Field(default=None, ge=1, le=3)
    branchDroop: float | None = Field(default=None, ge=0, le=1)
    branchStart: float | None = Field(default=None, ge=0.05, le=0.9)
    # Leaves.
    leafShape: LeafShape = "oval"
    # v1-v4 allowed 2-80 cm; v5 also covers small boxwood leaves and long palm fronds.
    leafSizeCm: float = Field(default=12, ge=0.5, le=200)
    leafSizeVariation: float | None = Field(default=None, ge=0, le=0.5)
    leafTipRatio: float | None = Field(default=None, ge=0.4, le=1.6)
    leafArrangement: Literal["alternate", "opposite", "whorled"] | None = None
    leafDensity: Literal["sparse", "low", "medium", "high", "dense"] = "medium"
    leafColor: str = Field(default="#4f793b", pattern=COLOR)
    flowerEnabled: bool = False
    flowerShape: FlowerShape = "five"
    flowerSizeCm: float = Field(default=10, ge=0.3, le=60)
    flowerColor: str = Field(default="#df7799", pattern=COLOR)
    seed: int = Field(default=12345, ge=0, le=2147483647)

    @model_validator(mode="after")
    def compatible_features(self):
        allowed = LEAF_SHAPES_BY_TYPE.get(self.plantType)
        if allowed and self.leafShape not in allowed:
            raise ValueError("Leaf shape is incompatible with the plant architecture")
        if self.plantType in FLOWERLESS_TYPES and self.flowerEnabled:
            raise ValueError("Flowers are not supported for this plant architecture")
        species = SPECIES.get(self.botanicalForm) if self.botanicalForm else None
        if species:
            if (self.plantType, self.leafShape) != (species.plant_type, species.leaf_shape):
                raise ValueError("植物の種類と植物タイプ・葉の形が一致しません。")
            if self.flowerEnabled and not species.flower_shapes:
                raise ValueError("この植物の種類には花を付けられません。")
            if self.flowerEnabled and self.flowerShape not in species.flower_shapes:
                raise ValueError("この植物の種類では選べない花の形です。")
        return self


class ModelPart(PlantModel):
    partId: PartId
    position: tuple[float, float, float]
    quaternion: tuple[float, float, float, float]
    scale: tuple[float, float, float]
    color: str | None = Field(default=None, pattern=COLOR)


class ModelDimensions(PlantModel):
    width: float = Field(gt=0, le=30)
    height: float = Field(gt=0, le=30)
    depth: float = Field(gt=0, le=30)


class PlantComposition(PlantModel):
    # v5 rules place the unchanged catalog v4 GLB parts.
    version: Literal[5]
    catalogVersion: Literal[4]
    profile: PlantProfile
    baseDimensions: ModelDimensions
    fitScale: tuple[float, float, float] = (1, 1, 1)
    parts: list[ModelPart] = Field(min_length=1, max_length=1500)
