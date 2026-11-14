"""R3a — Response planner for real BattLeDIM SCADA windows.

The demo What-If page simulates interventions on a synthetic network. The REAL
L-Town network has no embedded hydraulic model here, and inventing simulation
results would repeat the fabrication mistake this project removed. So this
module does the honest thing instead: it turns SCADA-derived quantities we can
actually compute (excess inflow, sag cluster, target pipe, branch) into
decision-support options with clearly stated assumptions and physical-unit
savings — never a fake simulated outcome.

Loss is measured against a CAUSAL 14-day baseline (the same construction the
ground-truth benchmark uses), because the operator's question — "how much
water is being lost NOW?" — is about the recent state, not the annual typical
state: multi-week leaks are absorbed into the annual median and would be
invisible there. The baseline source is always reported in the payload.

Options and their math:
  - Isolate: stops the leak -> saving = recent excess inflow (demand unaffected).
  - Throttle: lower pressure -> less leak flow. Literature leakage exponents
    span ~0.5-2.5, so a 20% pressure cut yields ~11-42% leak-flow reduction —
    reported as a RANGE, never a precise fake number.
  - Monitor: straight-line 24h projection at the current rate (upper bound).
  - Dispatch: field-crew package — target pipe (nearest to the sag-cluster
    centroid), reacting sensors, supply branch, model coordinates.

Ground truth is surfaced only in a labelled overlay (leak pipes active now).
"""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

from .detector import score_frame, get_reference, _hour_lookup, _hour_of
from .loader import get_leakages_df
from . import evaluate as ev
from . import network as net
from .replay import _get_merged

_PRESS_VOTE_Z = -1.5
_THROTTLE_CUT = 0.20          # 20% pressure reduction
_LEAK_EXPONENTS = (0.5, 2.5)  # literature range for leakage-pressure exponent n
_CAUSAL_DAYS = 14


def _resolve_window(event_pipe: Optional[str], points: int,
                    start: Optional[str], end: Optional[str]):
    """Mirror the telemetry endpoint's window derivation (so pages agree)."""
    points = max(12, min(int(points or 48), 145))
    matched = None
    if event_pipe:
        from .loader import get_leakage_events
        for e in get_leakage_events():
            if e.pipe.lower() == event_pipe.lower():
                matched = e
                break
    if matched:
        start_ts = pd.to_datetime(matched.start_time)
        start = start or (start_ts - pd.Timedelta(hours=6)).strftime("%Y-%m-%d %H:%M:%S")
        end = end or (start_ts + pd.Timedelta(hours=18)).strftime("%Y-%m-%d %H:%M:%S")
    if not start or not end:
        start, end = "2018-01-01 00:00:00", "2018-01-02 00:00:00"
    return start, end, points, matched


def _severity(peak_excess: float, recent_excess: float, elevated_min: float) -> str:
    if peak_excess >= 15 or recent_excess >= 10:
        return "HIGH"
    if peak_excess >= 4 or elevated_min >= 30:
        return "MEDIUM"
    if peak_excess > 0.5:
        return "LOW"
    return "NONE"


def respond_window(event_pipe: Optional[str] = None, points: int = 48,
                   start: Optional[str] = None, end: Optional[str] = None) -> dict:
    """Decision-support response plan for a real-SCADA window (SCADA only)."""
    w_start, w_end, n_points, matched = _resolve_window(event_pipe, points, start, end)

    merged = _get_merged()
    ref = get_reference()
    mask = (merged["Timestamp"] >= w_start) & (merged["Timestamp"] <= w_end)
    sub = merged[mask]
    if len(sub) > n_points:
        step = int(math.ceil(len(sub) / n_points))
        sub = sub.iloc[::step]
    if len(sub) < 12:
        raise ValueError(f"response window is empty ({w_start} .. {w_end})")

    causal, causal_note = ev._causal_stats(merged, ref, pd.to_datetime(w_start))
    scored = score_frame(sub, stats=causal).reset_index(drop=True)
    stats = causal or ref.stats

    times = sub["Timestamp"].tolist()
    hours = np.array([_hour_of(str(t)) for t in times], dtype=int)
    f_med, _ = _hour_lookup(stats["flow"], hours)
    flows = sub[ref.flow_sensors].apply(pd.to_numeric, errors="coerce")
    flows = flows.where(flows > 0)
    total_flow = flows.sum(axis=1, skipna=True).to_numpy(dtype=float)

    STEP_MIN = 5.0
    excess = np.array(
        [max(0.0, float(total_flow[i]) - (float(f_med[i]) if np.isfinite(f_med[i]) else 0.0))
         for i in range(len(times))],
        dtype=float,
    )
    latest_loss = float(excess[-1])
    peak_loss = float(excess.max())
    recent_loss = float(np.mean(excess[-6:])) if len(excess) >= 6 else latest_loss
    cumulative_m3 = float((excess * STEP_MIN / 60.0).sum())
    elevated_min = float((excess > 0.5).sum() * STEP_MIN)
    severity = _severity(peak_loss, recent_loss, elevated_min)
    loss_now = recent_loss >= 0.5

    # Sag cluster -> target pipe + branch (causal-scored z's)
    zmat = {}
    press_cols = [c for c in ref.press_sensors if c in sub.columns]
    presses = sub[press_cols].apply(pd.to_numeric, errors="coerce").where(lambda d: d > 0)
    for col in press_cols:
        stab = (causal or {}).get("sensor", {}).get(col) or ref.stats["sensor"].get(col)
        if not stab:
            continue
        smed, ssc = _hour_lookup(stab, hours)
        with np.errstate(all="ignore"):
            z = np.where(ssc > 0, (presses[col].to_numpy(dtype=float) - smed) / ssc, np.nan)
        zmat[col] = np.round(z, 3)
    sag = []
    for col, colz in zmat.items():
        finite = np.isfinite(colz)
        if finite.any() and float(np.nanmin(colz)) <= _PRESS_VOTE_Z:
            sag.append(col)
    branches: Dict[str, List[str]] = {}
    for s in sag:
        branches.setdefault(net.branch_of(s), []).append(s)
    primary_branch = max(branches.items(), key=lambda kv: len(kv[1]))[0] if branches else None
    localized = len([b for b in branches if b != net.UNASSIGNED]) <= 1 and len(sag) >= 2
    target = net.localize_nearest_pipe(sag) if sag else None
    reacted = scored["reacted_sensor"].iloc[-1] or None if len(scored) else None

    # Active answer-key pipes in-window (labelled overlay only)
    active_now: List[str] = []
    try:
        leak_df = get_leakages_df()
        lmask = (leak_df["Timestamp"] >= str(times[-1])[:19]) & (leak_df["Timestamp"] <= str(times[-1])[:19])
        row = leak_df[lmask]
        if not row.empty:
            active_now = [c for c in leak_df.columns if c != "Timestamp"
                          and float(pd.to_numeric(row[c], errors="coerce").fillna(0.0).iloc[0]) >= 0.5]
    except Exception:
        active_now = []

    # --- options -----------------------------------------------------------
    iso_saving = round(recent_loss * 1000, 0)
    n_lo, n_hi = _LEAK_EXPONENTS
    thr_lo = round(recent_loss * (1 - (1 - _THROTTLE_CUT) ** n_lo) * 1000, 0)   # weakest exponent -> smallest cut
    thr_hi = round(recent_loss * (1 - (1 - _THROTTLE_CUT) ** n_hi) * 1000, 0)   # strongest exponent -> biggest cut
    monitor_24h = round(recent_loss * 24.0, 1)

    options = [
        {
            "id": "isolate",
            "title": "Isolate the target pipe",
            "action": f"Close isolation valves on pipe {target['pipe'] if target else '—'} and verify the loss stops on the district meter.",
            "saving": {
                "kind": "point",
                "lph": iso_saving,
                "m3h": round(recent_loss, 2),
                "note": "Stopping the leak removes the excess inflow entirely; normal demand keeps flowing.",
            },
            "confidence": 0.85 if (target and localized) else 0.6,
            "data_basis": "Leak loss = SCADA inflow above the causal hour-of-day typical level; target pipe = nearest network pipe to the sag-cluster centroid.",
            "risks": "Customers between the valves may lose supply until repair — the SCADA data cannot tell us how many; the field crew confirms on site.",
            "urgency": "immediate" if severity == "HIGH" else "same shift" if severity == "MEDIUM" else "when convenient",
        },
        {
            "id": "throttle",
            "title": "Throttle branch pressure",
            "action": f"Reduce pressure on the affected supply branch ({net.branch_label(primary_branch) if primary_branch else '—'}) by ~20% while the repair is organised.",
            "saving": {
                "kind": "range",
                "low_lph": thr_lo,
                "high_lph": thr_hi,
                "note": "Leak flow falls with pressure. Literature exponents n=0.5-2.5 give 1-(0.8)^n = 11-42% reduction for a 20% cut.",
            },
            "confidence": 0.5,
            "data_basis": "Standard leakage-pressure relationship; exact response depends on where the leak sits in the network.",
            "risks": "Lower pressure can cause complaints at high points / far ends and let contamination ingress at dead ends if overdone. Check tank service levels.",
            "urgency": "same shift" if severity in ("HIGH", "MEDIUM") else "when convenient",
        },
        {
            "id": "monitor",
            "title": "Keep monitoring",
            "action": "Keep the detector live and re-check in 2-4 hours; escalate if the excess inflow grows.",
            "saving": {
                "kind": "projection",
                "next_24h_m3": monitor_24h,
                "note": "Water likely lost over the next 24h if this persists at the CURRENT rate (upper bound — it may grow).",
            },
            "confidence": 0.9,
            "data_basis": "Straight-line projection of the recent excess inflow (last 30 min mean).",
            "risks": "Every hour of delay costs ~" + f"{iso_saving:,.0f}" + " L. Not appropriate for HIGH severity.",
            "urgency": "n/a",
        },
        {
            "id": "dispatch",
            "title": "Dispatch a field crew",
            "action": f"Send a crew to inspect around pipe {target['pipe'] if target else '—'} (sensors {', '.join(sag[:3]) or reacted or '—'} reacted).",
            "saving": {
                "kind": "info",
                "note": "Confirms or corrects the SCADA-based localization; the first step of any physical repair.",
            },
            "confidence": 0.8 if sag else 0.4,
            "data_basis": "Sagging-sensor cluster mapped onto the L-Town GIS pipe graph.",
            "risks": "Crew time; localization is the nearest pipe to a cluster centroid — the true leak may be on an adjacent pipe.",
            "urgency": "immediate" if severity == "HIGH" else "same shift",
        },
    ]

    # --- recommendation ----------------------------------------------------
    if severity == "NONE":
        rec, reason = ["monitor"], "No measurable excess inflow in this window — nothing to act on yet."
    elif not loss_now:
        rec, reason = (
            ["dispatch", "monitor"],
            "A significant loss appeared in this window but is NOT present at the end (intermittent or already stopped). "
            "Dispatch a crew to verify the area on foot before any isolation — isolating now would save nothing.",
        )
    elif severity == "LOW":
        rec, reason = ["monitor", "dispatch"], "Small loss; keep watching and have a crew verify the area when convenient."
    elif severity == "MEDIUM":
        rec, reason = (["throttle", "dispatch"], "Moderate, sustained loss: throttle the branch to slow the loss while a crew confirms the spot.")
    elif localized:
        rec, reason = (["isolate", "dispatch"], "High loss localized to one supply branch: isolate the target pipe now and send a crew to confirm and repair.")
    else:
        rec, reason = (["dispatch", "throttle"], "High loss but the sag cluster spans branches: dispatch a crew to pin down the location; throttle in the meantime.")

    return {
        "window": {"start": str(times[0]), "end": str(times[-1]), "steps": len(times), "event_pipe": event_pipe or None},
        "situation": {
            "latest_loss_m3h": round(latest_loss, 2),
            "latest_loss_lph": round(latest_loss * 1000, 0),
            "recent_loss_m3h": round(recent_loss, 2),
            "recent_loss_lph": round(recent_loss * 1000, 0),
            "loss_now": loss_now,
            "peak_loss_m3h": round(peak_loss, 2),
            "cumulative_volume_m3": round(cumulative_m3, 1),
            "elevated_minutes": elevated_min,
            "severity": severity,
            "localized": localized,
            "primary_branch": primary_branch,
            "primary_branch_label": net.branch_label(primary_branch) if primary_branch else None,
            "target_pipe": target,
            "sag_sensors": sag,
            "reacted_sensor": reacted,
        },
        "options": options,
        "recommended": {"primary": rec[0], "supporting": rec[1:], "reason": reason},
        "answer_key_overlay": {
            "note": "Ground-truth overlay from the published BattLeDIM answer key — for after-the-fact comparison only, never an input to this planner.",
            "active_leaks_now": active_now,
            "matched_event": (
                {
                    "pipe": matched.pipe,
                    "start": matched.start_time,
                    "end": matched.end_time,
                    "max_rate_m3h": matched.max_rate,
                }
                if matched
                else None
            ),
        },
        "baseline_source": causal_note,
        "assumptions": [
            "Leak loss is measured as SCADA inflow above the CAUSAL hour-of-day typical level (14 days before the window) — the same baseline the ground-truth benchmark uses.",
            "No hydraulic model of the real L-Town network is embedded, so intervention outcomes are physical-unit estimates with stated assumptions — NOT simulated results. Demo mode has the true simulation.",
            "Isolate assumes the leak is on/after the target pipe and demand is unaffected; customer impact must be confirmed on site.",
            f"Throttle assumes a {_THROTTLE_CUT:.0%} pressure cut and literature leakage exponents {n_lo}-{n_hi}; the saving is therefore a range, not a prediction.",
            "Customer counts and repair costs are deliberately omitted — SCADA data cannot honestly provide them.",
        ],
        "provenance": {
            "analysis_inputs": "SCADA flow + pressure signals only",
            "ground_truth_used": False,
        },
    }
