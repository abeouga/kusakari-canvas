"""Frozen plant assembly rules v1-v4.

Gardens and EC products keep compositions produced by these rules, and a garden save re-resolves each
stored composition to verify it (see validation.py). The output of this package must therefore stay
byte-identical: do not change its geometry, schemas or catalogs. New behaviour belongs in ``plants`` (v5),
which never imports this package.
"""

from .plant_assembly import assemble as assemble_legacy
from .plant_schemas import PlantComposition as LegacyComposition
from .plant_schemas import PlantProfile as LegacyProfile

__all__ = ["LegacyComposition", "LegacyProfile", "assemble_legacy"]
