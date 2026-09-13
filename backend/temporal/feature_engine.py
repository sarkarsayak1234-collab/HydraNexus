"""Causal temporal feature engine for flow and pressure telemetry.

Every function takes an explicit index and only reads points[0..idx]:
at timestamp T, only data available at or before T is used. Appending future
points can never change features already computed for an earlier index.

Timestamp formats: "HH:MM" and "YYYY-MM-DD HH:MM:SS" (date part ignored for
ordering within a window; midnight rollover is unwrapped). Unparseable stamps
fall back to uniform 5-minute spacing so the engine never crashes.

Two reference frames (both causal, both labeled in output):
- Lags (5/15/30 min): exact time-based lookups; on sparse feeds they resolve
  to the nearest earlier point and report actual_minutes + truncated.
- Reference baseline: mean of the first third of points seen so far. When a
  window covers fault onset (the designed usage), this is the pre-event
  baseline, so sustained faults still grade correctly. Deviations are
  reported "vs window baseline" with the span stated.
"""
from __future__ import annotations
import math
import re

from .baseline import (
    mean, pstdev, zscore, grade_deviation, grade_trend, grade_value,
)
from .persistence import persistence_status
from .relationships import coupling_status

LAG_MINUTES = (5, 15, 30)
WINDOW_MINUTES = 30
SIGNALS = ("flow", "pressure")
# Medium-deviation bands reused for per-point anomaly flags.
MED_BAND = {"flow": 12.0, "pressure": 8.0}

_TIME_HM = re.compile(r"^(\d{1,2}):(\d{2})(?::(\d{2}))?$")
_TIME_FULL = re.compile(r"(\d{1,2}):(\d{2})(?::(\d{2}))?\s*$")


def parse_time_to_minutes(s) -> float | None:
    if s is None:
        return None
    text = str(s).strip()
    m = _TIME_HM.match(text) or _TIME_FULL.search(text)
    if not m:
        return None
    try:
        h, mi = int(m.group(1)), int(m.group(2))
        sec = int(m.group(3)) if m.group(3) else 0
    except (TypeError, ValueError):
        return None
    if not (0 <= h <= 23 and 0 <= mi <= 59 and 0 <= sec <= 59):
        return None
    return h * 60.0 + mi + sec / 60.0


def monotonic_minutes(times: list) -> list[float]:
    """Unwrap midnight rollover so the series is non-decreasing."""
    raw = [parse_time_to_minutes(t) for t in times]
    if any(v is None for v in raw):
        return [i * 5.0 for i in range(len(times))]
    out, day = [], 0
    prev = None
    for v in raw:
        if prev is not None and v < prev - 720.0:
            day += 1440.0
        out.append(v + day)
        prev = v
    return out


def _num(point: dict, key: str) -> float | None:
    try:
        v = float(point.get(key))
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


def reference_mean(values: list[float | None], idx: int) -> float | None:
    """Mean of the first third of points[0..idx] — pre-event when the window
    covers fault onset. Causal by construction."""
    k = max(1, (idx + 1) // 3)
    vals = [v for v in values[:k] if v is not None]
    if not vals:
        return None
    return sum(vals) / len(vals)


def lag_lookup(times: list[float], values: list[float | None], idx: int, lag_min: float) -> dict:
    """Latest value at least lag_min before times[idx] (causal)."""
    target = times[idx] - lag_min
    for j in range(idx, -1, -1):
        if times[j] <= target + 1e-9 and values[j] is not None:
            return {"value": values[j], "actual_minutes": round(times[idx] - times[j], 1),
                    "truncated": False}
    # Window shorter than the lag: fall back to the earliest valid point.
    for j in range(0, idx + 1):
        if values[j] is not None:
            return {"value": values[j], "actual_minutes": round(times[idx] - times[j], 1),
                    "truncated": True}
    return {"value": None, "actual_minutes": 0.0, "truncated": True}


def rolling_window_idx(times: list[float], idx: int, window_min: float = WINDOW_MINUTES) -> list[int]:
    lo = times[idx] - window_min
    return [j for j in range(idx + 1) if times[j] >= lo - 1e-9]


def least_squares_slope(xs: list[float], ys: list[float]) -> float:
    n = len(xs)
    if n < 2:
        return 0.0
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    if sxx <= 1e-12:
        return 0.0
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sxx


def _pct_change(current: float | None, ref: float | None) -> float:
    if current is None or ref is None or abs(ref) <= 1e-9:
        return 0.0
    return (current - ref) / abs(ref) * 100.0


def point_features(times: list[float], series: dict[str, list[float | None]], idx: int) -> dict:
    """Full temporal feature set for point idx (reads points[0..idx] only)."""
    feats: dict = {"index": idx, "time_minutes": times[idx], "signals": {}}
    for sig in SIGNALS:
        vals = series[sig]
        cur = vals[idx]
        lags = {}
        for lag in LAG_MINUTES:
            lk = lag_lookup(times, vals, idx, lag)
            lags[str(lag)] = {**lk,
                              "delta": (cur - lk["value"]) if cur is not None and lk["value"] is not None else 0.0,
                              "pct": _pct_change(cur, lk["value"])}
        win_idx = rolling_window_idx(times, idx)
        # Guarantee a minimum sample for sparse (e.g. hourly) feeds; flagged.
        sparse = len(win_idx) < 3
        if sparse:
            win_idx = list(range(max(0, idx - 2), idx + 1))
        wvals = [vals[j] for j in win_idx if vals[j] is not None]
        m = mean(wvals)
        s = pstdev(wvals, m)
        z = zscore(cur, m, s) if cur is not None else 0.0
        slope = least_squares_slope([times[j] for j in win_idx if vals[j] is not None], wvals)
        change_30m_pct = slope * 30.0 / abs(m) * 100.0 if abs(m) > 1e-9 else 0.0
        refm = reference_mean(vals, idx)
        feats["signals"][sig] = {
            "current": cur,
            "lags": lags,
            "reference": {"mean": refm,
                          "pct": _pct_change(cur, refm),
                          "span_points": max(1, (idx + 1) // 3)},
            "rolling": {"mean": round(m, 3), "std": round(s, 4), "z": round(z, 3),
                        "count": len(wvals), "window_minutes_actual": round(times[idx] - times[win_idx[0]], 1),
                        "sparse": sparse},
            "trend": {"slope_per_min": slope,
                      "change_pct_30m": round(change_30m_pct, 2),
                      "direction": "rising" if slope > 0 else ("falling" if slope < 0 else "flat")},
        }
    return feats


def point_anomalous(times: list[float], series: dict[str, list[float | None]], idx: int) -> bool:
    """Causal per-point anomaly flag: reference deviation or trailing z-spike."""
    for sig in SIGNALS:
        vals = series[sig]
        cur = vals[idx]
        if cur is None:
            continue
        refm = reference_mean(vals, idx)
        if refm is not None and abs(_pct_change(cur, refm)) >= MED_BAND[sig]:
            return True
        trail = [v for v in vals[max(0, idx - 11): idx + 1] if v is not None]
        if len(trail) >= 2:
            m = mean(trail)
            if abs(zscore(cur, m, pstdev(trail, m))) >= 2.0:
                return True
    return False


def _minute_of_day(times: list[float], idx: int) -> float:
    return times[idx] % 1440.0


def period_label(minute_of_day: float) -> str:
    h = minute_of_day / 60.0
    if 5 <= h < 11:
        return "morning"
    if 11 <= h < 15:
        return "midday"
    if 15 <= h < 21:
        return "evening"
    return "night"


def _fmt_pct(v: float) -> str:
    return f"{v:+.1f}%"


def analyze_temporal(points: list[dict], if_score: float | None = None) -> dict:
    """Temporal assessment of a telemetry window's latest point.

    points: ordered oldest→newest telemetry dicts with time/flow/pressure.
    if_score: existing IsolationForest 0..1 score, or None for model-free
      (real SCADA) mode — the temporal evidence stands on its own.
    """
    if not points:
        raise ValueError("telemetry window is empty")
    times = monotonic_minutes([p.get("time") for p in points])
    series = {sig: [_num(p, sig) for p in points] for sig in SIGNALS}
    idx = len(points) - 1

    # Per-point causal anomaly flags for persistence (each from its own past).
    flags: list[bool] = [point_anomalous(times, series, j) for j in range(idx + 1)]
    from .persistence import persistence_status
    persist = persistence_status(flags, times, idx)

    feats = point_features(times, series, idx)
    flow, press = feats["signals"]["flow"], feats["signals"]["pressure"]

    flow_dev = grade_deviation(abs(flow["reference"]["pct"]), flow["rolling"]["z"], "flow")
    press_dev = grade_deviation(abs(press["reference"]["pct"]), press["rolling"]["z"], "pressure")
    order = ["LOW", "MEDIUM", "HIGH"]
    trend_grade = max(
        grade_trend(abs(flow["trend"]["change_pct_30m"]), "flow"),
        grade_trend(abs(press["trend"]["change_pct_30m"]), "pressure"),
        key=lambda g: order.index(g),
    )

    # Historical context: are current readings outside the recent envelope?
    win_idx = rolling_window_idx(times, idx)
    if len(win_idx) < 2:
        win_idx = list(range(max(0, idx - 2), idx + 1))
    prior = win_idx[:-1]
    outside = 0
    checked = 0
    for sig in SIGNALS:
        vals = [series[sig][j] for j in prior if series[sig][j] is not None]
        cur = series[sig][idx]
        if vals and cur is not None:
            checked += 1
            lo, hi = min(vals), max(vals)
            span = (hi - lo) if hi > lo else abs(hi) or 1.0
            if cur < lo or cur > hi:
                outside += 1
            elif min(abs(cur - lo), abs(cur - hi)) / span <= 0.1:
                outside += 0.5
    context = "HIGH" if outside >= 2 else ("MEDIUM" if outside >= 1 else "LOW")

    # Cross-signal coupling over the recent window deltas.
    deltas_f = [series["flow"][j] - series["flow"][j - 1] for j in win_idx[1:]
                if series["flow"][j] is not None and series["flow"][j - 1] is not None]
    deltas_p = [series["pressure"][j] - series["pressure"][j - 1] for j in win_idx[1:]
                if series["pressure"][j] is not None and series["pressure"][j - 1] is not None]
    coupling = coupling_status(deltas_f, deltas_p)

    factors = {
        "flow_deviation": flow_dev,
        "pressure_deviation": press_dev,
        "trend": trend_grade,
        "persistence": persist["grade"],
        "historical_context": context,
    }
    evidence_score = round(sum(
        grade_value(g) for g in
        [flow_dev, press_dev, trend_grade, persist["grade"], context]
    ) / 5.0, 3)

    if if_score is None:
        score = evidence_score
        components = {"temporal_evidence": evidence_score, "model": None}
    else:
        try:
            base = max(0.0, min(1.0, float(if_score)))
        except (TypeError, ValueError):
            base = 0.0
        score = round(0.6 * base + 0.4 * evidence_score, 3)
        if persist["grade"] == "HIGH":
            score = round(min(0.99, score + 0.08), 3)
        components = {"isolation_forest": round(base, 3),
                      "temporal_evidence": evidence_score,
                      "persistence_boost": 0.08 if persist["grade"] == "HIGH" else 0.0}

    ref_span = flow["reference"]["span_points"]
    why: list[str] = []
    fz, pz = flow["rolling"]["z"], press["rolling"]["z"]
    fpct = flow["reference"]["pct"]
    ppct = press["reference"]["pct"]
    if flow_dev != "LOW":
        why.append(f"Flow {_fmt_pct(fpct)} vs window baseline (z {fz:+.1f}) — {flow_dev} deviation.")
    if press_dev != "LOW":
        why.append(f"Pressure {_fmt_pct(ppct)} vs window baseline (z {pz:+.1f}) — {press_dev} deviation.")
    if trend_grade != "LOW":
        dom = "flow" if abs(flow["trend"]["change_pct_30m"]) >= abs(press["trend"]["change_pct_30m"]) else "pressure"
        t = feats["signals"][dom]["trend"]
        why.append(f"{dom.capitalize()} trending {t['direction']} ({t['change_pct_30m']:+.1f}% per 30 min) — {trend_grade} trend.")
    if persist["grade"] != "LOW":
        hr = persist.get("horizon_run", persist["consecutive_points"])
        why.append(f"Abnormal pattern persisted {persist['duration_minutes']:.0f} min "
                   f"({hr}/{persist['horizon_points']} recent points).")
    if coupling["label"] == "leak-like coupling" and (flow_dev != "LOW" or press_dev != "LOW"):
        why.append(f"Flow↑ + pressure↓ coupling (r {coupling['correlation']:+.2f}) matches leak-like behavior.")
    if not why:
        why.append("Readings track their recent baselines with no sustained abnormal pattern.")
    if context == "HIGH":
        why.append("Current readings sit outside the recent operating envelope.")

    alarm = score >= 0.75 and persist["grade"] == "HIGH"
    mod = _minute_of_day(times, idx)
    return {
        "score": score,
        "score_components": components,
        "factors": factors,
        "why": why[:4],
        "persistence": persist,
        "relationships": coupling,
        "window": {
            "points": len(points),
            "span_minutes": round(times[idx] - times[0], 1),
            "reference_points": ref_span,
            "lateral": {sig: feats["signals"][sig]["lags"] for sig in SIGNALS},
            "time_of_day": {"minute": round(mod, 1), "period": period_label(mod)},
        },
        "evidence_lines": [
            f"Temporal pattern {persist['duration_minutes']:.0f} min persistent "
            f"({persist.get('horizon_run', persist['consecutive_points'])}/{persist['horizon_points']} recent points); "
            f"flow {_fmt_pct(fpct)}, pressure {_fmt_pct(ppct)} vs window baseline.",
        ],
        "alarm": alarm,
        "no_future_leakage": True,
    }
