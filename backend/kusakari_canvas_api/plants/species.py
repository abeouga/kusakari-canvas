"""Plant types and species as data. Growth code reads only the resolved ``Traits``.

A seller leaves most shape fields empty (null). Each field then takes the species value, else the plant
type value below. Adding a species means adding a row here, not a new growth function.
"""

from dataclasses import dataclass, field, replace

# Which growth routine builds each plant type (see growth.py).
ARCHITECTURE = {"tree": "woody", "conifer": "woody", "multistem": "woody", "shrub": "woody",
                "spreading": "woody", "flower": "herb", "vine": "herb", "grass": "tuft",
                "rosette": "rosette", "palm": "palm"}
LEAF_SHAPES_BY_TYPE = {"conifer": {"needle", "scale"}, "grass": {"grass"}, "palm": {"frond"},
                       "rosette": {"succulent", "narrow", "oval", "heart", "round"},
                       "vine": {"oval", "round", "heart", "palmate", "split", "compound"}}
FLOWERLESS_TYPES = {"conifer", "palm"}
# Leaf nodes per shoot. Five steps; v1-v4 used three (low/medium/high).
LEAF_NODES = {"sparse": 2, "low": 3, "medium": 5, "high": 7, "dense": 9}
# Leaf multiplier for plants whose leaves come straight from the crown (rosette, palm, monstera).
CROWN_LEAVES = {"sparse": 0.6, "low": 1.0, "medium": 1.5, "high": 2.2, "dense": 3.0}
# Share of a woody crown surface covered by leaves.
COVER = {"sparse": 0.25, "low": 0.4, "medium": 0.6, "high": 0.85, "dense": 1.1}


@dataclass(frozen=True)
class Shape:
    stem_count: int
    stem_curve: float
    stem_taper: float
    twig_length: float
    branch_levels: int
    branch_droop: float
    branch_start: float
    leaf_variation: float
    leaf_tip_ratio: float
    arrangement: str
    # Horizontal lean of multiple main stems, as a share of the plant width.
    stem_spread: float = 0.0
    # Multiplier on leaf nodes per shoot (fine-leaved conifers need many more than broadleaves).
    node_factor: float = 1.0


TYPE_SHAPES = {
    "tree": Shape(1, 0.2, 0.7, 1.0, 3, 0.0, 0.35, 0.15, 0.85, "alternate"),
    "conifer": Shape(1, 0.05, 0.85, 1.0, 2, 0.1, 0.06, 0.12, 0.8, "whorled", node_factor=1.6),
    "multistem": Shape(3, 0.25, 0.7, 1.0, 2, 0.05, 0.3, 0.15, 0.85, "alternate", 0.24),
    "shrub": Shape(5, 0.25, 0.6, 1.0, 2, 0.05, 0.15, 0.15, 0.85, "alternate", 0.36),
    "spreading": Shape(7, 0.35, 0.6, 1.1, 2, 0.15, 0.1, 0.15, 0.85, "alternate", 0.46),
    "flower": Shape(1, 0.25, 0.5, 1.0, 2, 0.05, 0.1, 0.15, 0.75, "alternate"),
    "vine": Shape(1, 0.6, 0.4, 1.0, 1, 0.45, 0.1, 0.15, 0.85, "alternate"),
    "grass": Shape(1, 0.3, 0.5, 1.0, 1, 0.35, 0.05, 0.15, 1.0, "alternate"),
    "rosette": Shape(1, 0.0, 0.5, 1.0, 1, 0.0, 0.1, 0.05, 0.64, "alternate"),
    "palm": Shape(1, 0.15, 0.3, 1.0, 1, 0.3, 0.8, 0.1, 1.0, "alternate"),
}


@dataclass(frozen=True)
class SpeciesRule:
    plant_type: str
    leaf_shape: str
    flower_shapes: tuple = ()
    # Leaf GLBs used in rotation, e.g. two flat maple leaves for every curled one.
    leaf_parts: tuple = ()
    flower_part: str | None = None
    features: frozenset = frozenset()
    shape: dict = field(default_factory=dict)


SPECIES = {
    "maple": SpeciesRule("tree", "palmate", (), ("leaf-maple", "leaf-maple", "leaf-maple-curl"),
                         features=frozenset({"petiole"}),
                         shape={"arrangement": "opposite", "stem_curve": 0.3, "branch_start": 0.3}),
    "monstera": SpeciesRule("flower", "split", (), ("leaf-monstera",),
                            features=frozenset({"single_leaf", "aerial_roots"}),
                            shape={"stem_curve": 0.35, "leaf_variation": 0.12, "leaf_tip_ratio": 1.0}),
    "iberis": SpeciesRule("spreading", "narrow", ("four",), ("leaf-iberis-v4",), "flower-iberis-v4",
                          frozenset({"upright_leaves", "shoot_flowers"}),
                          {"stem_count": 6, "branch_levels": 1, "branch_start": 0.25, "stem_curve": 0.5}),
    "hakone": SpeciesRule("grass", "grass", ("four", "five", "eight", "spike", "cluster", "daisy", "bell", "plume"),
                          ("leaf-hakone", "leaf-hakone", "leaf-hakone", "leaf-hakone-curl"),
                          features=frozenset({"flow"}), shape={"branch_droop": 0.5, "stem_curve": 0.4}),
    "goldcrest": SpeciesRule("conifer", "scale", (), ("leaf-goldcrest",),
                             features=frozenset({"upright_leaves"}),
                             shape={"branch_start": 0.02, "stem_curve": 0.03}),
    "olive": SpeciesRule("tree", "narrow", ("cluster",),
                         shape={"arrangement": "opposite", "stem_curve": 0.45, "branch_droop": 0.15,
                                "leaf_variation": 0.2}),
    "lavender": SpeciesRule("shrub", "narrow", ("spike",), features=frozenset({"flower_stalks"}),
                            shape={"stem_count": 8, "branch_levels": 1, "branch_start": 0.08,
                                   "arrangement": "opposite", "stem_spread": 0.28}),
    "rose": SpeciesRule("shrub", "compound", ("five", "eight"),
                        shape={"stem_count": 5, "branch_droop": 0.12, "stem_curve": 0.3}),
    "hydrangea": SpeciesRule("shrub", "oval", ("cluster",), features=frozenset({"petiole"}),
                             shape={"stem_count": 6, "branch_levels": 1, "arrangement": "opposite"}),
    "boxwood": SpeciesRule("shrub", "round", (),
                           shape={"stem_count": 5, "branch_levels": 3, "branch_start": 0.1, "arrangement": "opposite",
                                  "leaf_variation": 0.08, "leaf_tip_ratio": 0.9}),
    "hosta": SpeciesRule("rosette", "heart", ("bell",), features=frozenset({"petiole", "flower_stalks"}),
                         shape={"leaf_tip_ratio": 0.7, "leaf_variation": 0.1, "branch_droop": 0.35}),
}


@dataclass(frozen=True)
class Traits:
    architecture: str
    shape: Shape
    branch_count: int
    branch_angle: float
    leaf_size: float
    leaf_nodes: int
    crown_leaves: float
    cover: float
    leaf_parts: tuple
    flower_part: str | None
    flower_size: float
    features: frozenset


def resolve_traits(profile) -> Traits:
    species = SPECIES.get(profile.botanicalForm) if profile.botanicalForm else None
    shape = replace(TYPE_SHAPES[profile.plantType], **(species.shape if species else {}))
    chosen = {"stem_count": profile.stemCount, "stem_curve": profile.stemCurve, "stem_taper": profile.stemTaper,
              "twig_length": profile.twigLength, "branch_levels": profile.branchLevels,
              "branch_droop": profile.branchDroop, "branch_start": profile.branchStart,
              "leaf_variation": profile.leafSizeVariation, "leaf_tip_ratio": profile.leafTipRatio,
              "arrangement": profile.leafArrangement}
    shape = replace(shape, **{key: value for key, value in chosen.items() if value is not None})
    flower_part = None
    if profile.flowerEnabled:
        flower_part = species.flower_part if species and species.flower_part else f"flower-{profile.flowerShape}"
    return Traits(
        architecture=ARCHITECTURE[profile.plantType], shape=shape, branch_count=profile.branchCount,
        branch_angle=profile.branchAngle, leaf_size=profile.leafSizeCm / 100,
        leaf_nodes=max(1, round(LEAF_NODES[profile.leafDensity] * shape.node_factor)),
        crown_leaves=CROWN_LEAVES[profile.leafDensity], cover=COVER[profile.leafDensity],
        leaf_parts=species.leaf_parts if species and species.leaf_parts else (f"leaf-{profile.leafShape}",),
        flower_part=flower_part, flower_size=profile.flowerSizeCm / 100,
        features=species.features if species else frozenset())
