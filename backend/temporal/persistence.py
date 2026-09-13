"""Anomaly persistence / duration tracking over causal windows.

Persistence answers: "is this a one-off spike or a stuck abnormal pattern?"
Only points at or before T participate — a future spike can never lengthen a
past duration.
"""
from __future__ import annotations


def trailing_run(flags: list[bool]) -> int:
    """Length of the trailing consecutive True run (0 when latest is False)."""
    run = 0
    for f in reversed(flags):
        if f:
            run += 1
        else:
            break
    return run


def persistence_status(flags: list[bool], times_min: list[float], idx: int) -> dict:
    """Describe persistence of the anomaly run ending at point idx.

    flags[j] must be causal (computed from points[0..j] only). Ratio is measured
    against the recent horizon: points within the last 60 minutes (or the last
    12 points when data is sparse), so long real-SCADA windows don't dilute a
    sustained multi-hour fault.
    """
    window = flags[: idx + 1]
    t = times_min[: idx + 1]
    run = trailing_run(window)
    # Recent horizon for the ratio denominator.
    horizon_start = t[idx] - 60.0
    horizon = [j for j in range(len(window)) if t[j] >= horizon_start]
    if len(horizon) < 12 and len(window) >= 12:
        horizon = list(range(len(window) - 12, len(window)))
    if not horizon:
        horizon = list(range(len(window)))
    hlen = len(horizon)
    in_horizon_run = 0
    for j in reversed(horizon):
        if window[j]:
            in_horizon_run += 1
        else:
            break
    ratio = (in_horizon_run / hlen) if hlen else 0.0
    duration = (t[idx] - t[horizon[-in_horizon_run]]) if in_horizon_run else 0.0
    return {
        "consecutive_points": run,
        "horizon_points": hlen,
        "horizon_run": in_horizon_run,
        "ratio": round(ratio, 3),
        "duration_minutes": round(duration, 1),
        "grade": grade_persistence(ratio, run),
    }


def grade_persistence(ratio: float, run: int) -> str:
    # A lone single-point spike never counts as HIGH persistence.
    if run >= 3 and ratio >= 0.4:
        return "HIGH"
    if run >= 2 and ratio >= 0.6:
        return "HIGH"
    if run >= 2 and ratio >= 0.25:
        return "MEDIUM"
    if ratio >= 0.5:
        return "MEDIUM"
    return "LOW"
