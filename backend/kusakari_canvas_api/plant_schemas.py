"""Stored plant compositions: frozen v1-v4 (plant_legacy) or current v5 (plants)."""

from typing import Annotated

from pydantic import Discriminator, Tag, TypeAdapter

from .plant_legacy import LegacyComposition, assemble_legacy
from .plants import PlantComposition as CurrentComposition
from .plants import PlantProfile, assemble


def _composition_kind(value) -> str:
    # v1 snapshots may omit "version"; everything except 5 is a frozen legacy rule.
    version = value.get("version") if isinstance(value, dict) else getattr(value, "version", None)
    return "current" if version == 5 else "legacy"


PlantComposition = Annotated[
    Annotated[CurrentComposition, Tag("current")] | Annotated[LegacyComposition, Tag("legacy")],
    Discriminator(_composition_kind),
]
composition_adapter = TypeAdapter(PlantComposition)


def resolve_saved(composition) -> CurrentComposition | LegacyComposition:
    """Re-run the rules that produced ``composition``, to verify a client-submitted snapshot."""
    if composition.version == 5:
        return assemble(composition.profile)
    return assemble_legacy(composition.profile, composition.version)


__all__ = ["PlantComposition", "PlantProfile", "composition_adapter", "resolve_saved"]
