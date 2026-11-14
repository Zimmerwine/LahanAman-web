"""Shared validation for continuous slope measurements used by ETL pipelines."""

from __future__ import annotations

import math
from typing import Optional


SLOPE_CLASS_MIDPOINT_DEG = {
    1: 3.5,
    2: 11.5,
    3: 20.0,
    4: 30.0,
    5: 38.0,
}


def resolve_slope_degree(sampled_deg: Optional[float], fallback_score: int) -> float:
    """Keep a valid sampled angle intact; use the old class midpoint only if absent/invalid."""
    if sampled_deg is not None:
        try:
            value = float(sampled_deg)
        except (TypeError, ValueError):
            value = math.nan
        if math.isfinite(value) and 0.0 <= value < 90.0:
            return round(value, 2)

    try:
        score = int(fallback_score)
    except (TypeError, ValueError):
        score = 1
    if score not in range(1, 6):
        score = 1
    return SLOPE_CLASS_MIDPOINT_DEG[score]
