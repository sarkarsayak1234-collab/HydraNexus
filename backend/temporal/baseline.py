"""Causal rolling baselines and deviation grading.

All helpers are pure functions of explicitly passed values — no hidden state,
no future data. Thresholds mirror the domain bands already used in app/ai.py
(flow moves on a larger scale than pressure, so its bands are wider).
"""
from __future__ import annotations
import math

# (HIGH at/above, MEDIUM at/above) absolute % bands per signal.
DEVIATION_BANDS = {
    "flow": (25.0, 12.0),
    "pressure": (15.0, 8.0),
}

# Bands for the 30-minute extrapolated trend change (percent of baseline).
TREND_BANDS_30MIN_PCT = {
    "flow": (12.0, 5.0),
    "pressure": (6.0, 2.5),
}

GRADE_VALUE = {"HIGH": 1.0, "MEDIUM": 0.55, "LOW": 0.15}


def mean(values: list[float]) -> float:
    vals = [v for v in values if v is not None and math.isfinite(v)]
    if not vals:
        return 0.0
    return sum(vals) / len(vals)


def pstdev(values: list[float], m: float | None = None) -> float:
    """Population standard deviation (0.0 when undefined or degenerate)."""
    vals = [v for v in values if v is not None and math.isfinite(v)]
    if len(vals) < 2:
        return 0.0
    m = mean(vals) if m is None else m
    return math.sqrt(sum((v - m) ** 2 for v in vals) / len(vals))


def zscore(x: float, m: float, s: float) -> float:
    if not math.isfinite(x) or s <= 1e-9:
        return 0.0
    return (x - m) / s


def grade_from_bands(abs_pct: float, high: float, med: float) -> str:
    if abs_pct >= high:
        return "HIGH"
    if abs_pct >= med:
        return "MEDIUM"
    return "LOW"


def _upgrade(base: str, other: str) -> str:
    order = ["LOW", "MEDIUM", "HIGH"]
    return other if order.index(other) > order.index(base) else base


def grade_deviation(abs_pct_change: float, z: float, signal: str) -> str:
    """Grade a deviation using % bands, cross-checked with the z-score."""
    high, med = DEVIATION_BANDS.get(signal, (25.0, 12.0))
    grade = grade_from_bands(abs_pct_change, high, med)
    az = abs(z)
    if az >= 3.0 and abs_pct_change >= med:
        grade = _upgrade(grade, "HIGH")
    elif az >= 2.0:
        grade = _upgrade(grade, "MEDIUM")
    return grade


def grade_trend(abs_change_pct_30m: float, signal: str) -> str:
    high, med = TREND_BANDS_30MIN_PCT.get(signal, (12.0, 5.0))
    return grade_from_bands(abs_change_pct_30m, high, med)


def grade_value(grade: str) -> float:
    return GRADE_VALUE.get(grade, 0.15)
