"""Real-data investigation & impact engines (R1 + R2).

Both functions consume the same window payload as `detector.analyze_real`:
SCADA-only telemetry points (time, flows, pressures). Ground-truth fields
(leak_rate / active_leaks) present in the dicts are ignored by the analysis
and surfaced only in clearly-labelled answer-key overlays.

investigate_real — root-cause view for real SCADA:
  - per-sensor robust pressure-z ranking (which sensors reacted hardest)
  - inflow decomposition per meter (who caused the elevated inflow)
  - hour-of-day context (is this just the morning ramp?)
  - alarm timeline
  - supply-branch attribution of the pressure-sag cluster (network graph)

impact_real — decision-support impact view for real SCADA:
  - estimated loss rate (excess inflow above the hour-of-day typical level)
  - cumulative excess volume over the window
  - elevated-duration
  - affected supply branch + sagging sensors + nearest-pipe localization
  - answer-key overlay (actual leak rate / active pipes) for validation only
"""
from __future__ import annotations

from typing import Any, Dict, List

import numpy as np
import pandas as pd

from .detector import (
    _hour_lookup,
    _hour_of,
    get_reference,
    score_frame,
    Z_PRESS_VOTE,
    Z_FLOW_ALARM,
)
from . import network as net

_PRESS_VOTE_Z = -Z_PRESS_VOTE  # sensors below this z count as "sagging"


def _frame_from_points(points: List[Dict[str, Any]]) -> pd.DataFrame:
    ref = get_reference()
    rows = []
    for p in points:
        flows = p.get("flows") or {}
        presses = p.get("pressures") or {}
        row = {"Timestamp": str(p.get("time") or "")}
        for col in ref.flow_sensors:
            row[col] = float(flows.get(col, float("nan")) or 0.0)
        for col in ref.press_sensors:
            row[col] = float(presses.get(col, float("nan")) or 0.0)
        rows.append(row)
    return pd.DataFrame(rows)


def _sensor_press_z(points: List[Dict[str, Any]]) -> pd.DataFrame:
    """Per-sensor robust hour-of-day z over the window (index=timestamps, cols=sensors)."""
    ref = get_reference()
    frame = _frame_from_points(points)
    hours = np.array([h if h in ref.stats["flow"] else 0 for h in frame["Timestamp"].map(_hour_of)], dtype=int)
    out = {}
    for col in ref.press_sensors:
        if col not in frame.columns:
            continue
        vals = pd.to_numeric(frame[col], errors="coerce").where(lambda s: s > 0)
        stab = ref.stats["sensor"].get(col)
        if not stab:
            continue
        smed, ssc = _hour_lookup(stab, hours)
        with np.errstate(all="ignore"):
            z = np.where(ssc > 0, (vals.to_numpy(dtype=float) - smed) / ssc, np.nan)
        out[col] = np.round(z, 3)
    return pd.DataFrame(out, index=frame["Timestamp"].tolist())


def investigate_real(points: List[Dict[str, Any]]) -> dict:
    """Root-cause investigation for a real-SCADA window (SCADA signals only)."""
    if not points:
        raise ValueError("real telemetry window is empty")
    ref = get_reference()
    scored = score_frame(_frame_from_points(points)).reset_index(drop=True)
    times = [str(p.get("time") or "") for p in points]
    latest_idx = len(points) - 1

    # --- per-sensor pressure z ranking -----------------------------------
    zmat = _sensor_press_z(points)
    ranking = []
    for col in zmat.columns:
        colz = zmat[col].to_numpy(dtype=float)
        finite = np.isfinite(colz)
        if not finite.any():
            continue
        min_z = float(np.nanmin(colz))
        latest_z = float(colz[-1]) if finite[-1] else None
        peak_i = int(np.nanargmin(colz))
        sag_steps = int(np.nansum(colz <= _PRESS_VOTE_Z))
        ranking.append({
            "sensor": col,
            "min_z": round(min_z, 2),
            "latest_z": None if latest_z is None else round(latest_z, 2),
            "worst_at": times[peak_i] if peak_i < len(times) else None,
            "sag_steps": sag_steps,
            "branch": net.branch_of(col),
        })
    ranking.sort(key=lambda r: r["min_z"])
    for i, r in enumerate(ranking, 1):
        r["rank"] = i
    sag_sensors = [r["sensor"] for r in ranking if r["min_z"] <= _PRESS_VOTE_Z]

    # --- inflow decomposition per meter ----------------------------------
    hour = _hour_of(times[latest_idx])
    meters = []
    for col in ref.flow_sensors:
        mtab = ref.stats["meters"].get(col) or {}
        mrow = mtab.get(hour, {})
        mmed = mrow.get("med")
        latest_val = float((points[latest_idx].get("flows") or {}).get(col, 0.0) or 0.0)
        excess = max(0.0, latest_val - mmed) if mmed is not None else None
        meters.append({
            "meter": col,
            "latest": round(latest_val, 2),
            "typical_for_hour": None if mmed is None else round(float(mmed), 2),
            "excess": None if excess is None else round(float(excess), 2),
        })
    meters.sort(key=lambda m: -(m["excess"] or 0.0))

    # --- hour-of-day context ---------------------------------------------
    flow_tab = ref.stats["flow"].get(hour, {})
    f_med, f_sc = _hour_lookup(ref.stats["flow"], np.array([hour]))
    latest_flow = float(points[latest_idx].get("flow") or 0.0)
    band = None
    if np.isfinite(f_med[0]) and np.isfinite(f_sc[0]) and f_sc[0] > 0:
        band = {
            "lo": round(float(f_med[0] - 2 * f_sc[0]), 1),
            "hi": round(float(f_med[0] + 2 * f_sc[0]), 1),
        }
    hour_context = {
        "hour": hour,
        "latest_flow": round(latest_flow, 1),
        "typical": None if not np.isfinite(f_med[0]) else round(float(f_med[0]), 1),
        "band_2sigma": band,
        "within_band": bool(band and band["lo"] <= latest_flow <= band["hi"]),
    }

    # --- alarm timeline ---------------------------------------------------
    alarm_steps = [
        {"time": times[i], "z_flow": float(scored["z_flow"].iloc[i]), "sustained": bool(scored["sustained_alarm"].iloc[i])}
        for i in range(len(points))
        if bool(scored["alarm"].iloc[i]) or bool(scored["sustained_alarm"].iloc[i])
    ]
    first_alarm = next((a["time"] for a in alarm_steps if a["sustained"]), None)

    # --- supply-branch attribution ---------------------------------------
    branches: Dict[str, List[str]] = {}
    for s in sag_sensors:
        b = net.branch_of(s)
        if b:
            branches.setdefault(b, []).append(s)
    branch_rows = [
        {"branch": b, "label": net.branch_label(b), "sensors": sensors, "count": len(sensors),
         "centroid": net.centroid(sensors)}
        for b, sensors in sorted(branches.items(), key=lambda kv: -len(kv[1]))
    ]
    localized = len(branches) == 1 and len(sag_sensors) >= 2
    nearest = net.localize_nearest_pipe(sag_sensors) if sag_sensors else None
    if not sag_sensors:
        note = "No sensor below the sag threshold in this window — no localization signal."
    elif len(sag_sensors) == 1:
        note = f"Single sensor ({sag_sensors[0]}) below the sag threshold — a weak localization signal; treat with caution."
    elif localized:
        note = "Sagging sensors cluster on one supply branch — consistent with a single localized loss."
    else:
        note = "Sagging sensors span multiple supply branches — consistent with widespread demand variation or a large event."
    attribution = {
        "sag_sensor_count": len(sag_sensors),
        "vote_threshold_z": _PRESS_VOTE_Z,
        "branches": branch_rows,
        "localized_to_one_branch": localized,
        "nearest_pipe_to_cluster_centroid": nearest,
        "note": note,
    }

    # --- evidence ---------------------------------------------------------
    top = ranking[0] if ranking else None
    evidence = []
    if top:
        evidence.append(
            f"Strongest reacting sensor {top['sensor']} (z {top['min_z']:+.2f} at {top['worst_at']}, branch {top['branch']})"
        )
    if meters and meters[0]["excess"]:
        evidence.append(
            f"Largest inflow excess: {meters[0]['meter']} +{meters[0]['excess']:.1f} m3/h vs its hour-of-day typical level"
        )
    if hour_context["typical"] is not None:
        evidence.append(
            f"Total inflow {hour_context['latest_flow']:.1f} m3/h vs {hour_context['typical']:.1f} m3/h typical for hour {hour:02d}:00"
            + (" (within the normal 2-sigma band)" if hour_context["within_band"] else " (outside the normal 2-sigma band)")
        )
    evidence.append(f"{attribution['sag_sensor_count']} sensor(s) below the sag threshold (z <= {_PRESS_VOTE_Z}): {attribution['note']}")
    if first_alarm:
        evidence.append(f"First sustained alarm at {first_alarm}")

    return {
        "window": {"start": times[0], "end": times[-1], "points": len(points)},
        "sensor_ranking": ranking[:12],
        "sag_sensors": sag_sensors,
        "meter_decomposition": meters,
        "hour_context": hour_context,
        "alarm_timeline": {
            "first_sustained": first_alarm,
            "alarm_step_count": len(alarm_steps),
            "steps": alarm_steps[:40],
        },
        "attribution": attribution,
        "evidence": evidence,
        "provenance": {
            "analysis_inputs": "SCADA flow + pressure signals only",
            "ground_truth_used": False,
        },
    }


def impact_real(points: List[Dict[str, Any]]) -> dict:
    """Decision-support impact estimate for a real-SCADA window (SCADA signals only)."""
    if not points:
        raise ValueError("real telemetry window is empty")
    ref = get_reference()
    scored = score_frame(_frame_from_points(points)).reset_index(drop=True)
    times = [str(p.get("time") or "") for p in points]
    step_hours = [_hour_of(t) for t in times]
    f_med, _ = _hour_lookup(ref.stats["flow"], step_hours)

    STEP_MINUTES = 5.0  # BattLeDIM native interval
    excesses, actual_vols = [], []
    for i, p in enumerate(points):
        flow = float(p.get("flow") or 0.0)
        typ = float(f_med[i]) if np.isfinite(f_med[i]) else 0.0
        excesses.append(max(0.0, flow - typ))
        # answer-key overlay only — never an input
        actual_vols.append(float(p.get("leak_rate") or 0.0))

    latest_idx = len(points) - 1
    excess = np.array(excesses, dtype=float)
    peak_excess = float(excess.max())
    latest_excess = float(excess[latest_idx])
    cumulative_m3 = float((excess * STEP_MINUTES / 60.0).sum())
    elevated = excess > 0.5
    elevated_min = float(elevated.sum() * STEP_MINUTES)

    zmat = _sensor_press_z(points)
    sag_sensors, sensor_rows = [], []
    for col in zmat.columns:
        colz = zmat[col].to_numpy(dtype=float)
        if not np.isfinite(colz).any():
            continue
        min_z = float(np.nanmin(colz))
        if min_z <= _PRESS_VOTE_Z:
            sag_sensors.append(col)
        sensor_rows.append({"sensor": col, "min_z": round(min_z, 2)})
    sensor_rows.sort(key=lambda r: r["min_z"])

    branches: Dict[str, List[str]] = {}
    for s in sag_sensors:
        b = net.branch_of(s)
        if b:
            branches.setdefault(b, []).append(s)
    primary_branch = max(branches.items(), key=lambda kv: len(kv[1]))[0] if branches else None
    nearest = net.localize_nearest_pipe(sag_sensors) if sag_sensors else None

    # Answer-key overlay (labelled; for after-the-fact comparison only)
    answer_key = {
        "note": "Ground-truth overlay from the published BattLeDIM answer key — shown for validation only, never used by the analysis.",
        "active_leaks_now": points[latest_idx].get("active_leaks") or [],
        "actual_loss_latest_m3h": round(actual_vols[latest_idx], 2),
        "actual_volume_window_m3": round(sum(actual_vols) * STEP_MINUTES / 60.0, 1),
    }

    severity = "HIGH" if (peak_excess >= 15 or latest_excess >= 10) else "MEDIUM" if (peak_excess >= 4 or elevated_min >= 30) else "LOW" if peak_excess > 0.5 else "NONE"

    return {
        "window": {"start": times[0], "end": times[-1], "points": len(points), "step_minutes": STEP_MINUTES},
        "estimated_loss": {
            "latest_m3h": round(latest_excess, 2),
            "latest_lph": round(latest_excess * 1000, 0),
            "peak_m3h": round(peak_excess, 2),
            "peak_lph": round(peak_excess * 1000, 0),
            "cumulative_volume_m3": round(cumulative_m3, 1),
            "elevated_minutes": round(elevated_min, 0),
            "method": "Excess = inflow above the hour-of-day typical level (robust median baseline), integrated over the window",
        },
        "severity": severity,
        "affected_area": {
            "sag_sensors": sag_sensors,
            "sensor_count": len(sag_sensors),
            "branches": [
                {"branch": b, "label": net.branch_label(b), "sensors": sensors, "count": len(sensors),
                 "centroid": net.centroid(sensors)}
                for b, sensors in sorted(branches.items(), key=lambda kv: -len(kv[1]))
            ],
            "primary_branch": primary_branch,
            "primary_branch_label": net.branch_label(primary_branch) if primary_branch else None,
            "nearest_pipe_to_cluster_centroid": nearest,
        },
        "answer_key_overlay": answer_key,
        "provenance": {
            "analysis_inputs": "SCADA flow + pressure signals only",
            "ground_truth_used": False,
        },
    }
