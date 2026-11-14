"""Hydraulic digital twin for L-Town (Option B / R3b-lite).

Loads the OFFICIAL EPANET model published with BattLeDIM (L-TOWN_v2_Model.inp,
KIOS Research — the same network family our SCADA data and frontend GIS come
from) and runs real hydraulic simulations with WNTR/EPANET:

- state:  the full pipe table hydraulics — flow in every one of the 905 pipes
          and pressure at every node — for painting the whole map physically
- whatif: a leak (emitter sized from the SCADA-derived excess inflow, placed at
          the node nearest the sag-cluster centroid) is injected, then an
          intervention (isolate pipe / throttle pipe) is applied, and three
          simulations are compared: baseline vs leak vs leak+action.

Honesty rules baked in:
- simulations use the model's WEEKLY demand patterns, phase-aligned to the
  calendar week of the analysed window (the base model has no seasonal
  pattern), so results are "a typical week of this network, aligned to when
  the event happened" — NOT a replay of the 2018 measurements. Deltas (what
  changes when you act) are the trustworthy output; absolute values are
  model estimates and labelled as such.
- leak size = SCADA excess inflow (never the answer key).
- isolating a pipe that does not feed the leak node will NOT stop the leak —
  the simulator reports that honestly (it is real information for the crew).

WNTR returns SI units (m3/s, m); everything crossing this module's boundary is
converted to CMH (m3/h) to match the rest of the app.
"""
from __future__ import annotations

import threading
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

_INP = Path(__file__).resolve().parent.parent / "data" / "real" / "L-TOWN_v2_Model.inp"

_LOCK = threading.RLock()
_CACHE: Dict[str, Dict[str, Any]] = {}
_MAX_CACHE = 16

_EMITTER_EXP = 0.5  # matches [OPTIONS] Emitter Exponent in the model file


def _cmh(flow_si: float) -> float:
    """SI m3/s -> CMH (m3/h)."""
    return flow_si * 3600.0


def _cache_put(key: str, value: Dict[str, Any]) -> None:
    with _LOCK:
        _CACHE[key] = value
        if len(_CACHE) > _MAX_CACHE:
            _CACHE.pop(next(iter(_CACHE)))


def _cache_get(key: str) -> Optional[Dict[str, Any]]:
    with _LOCK:
        return _CACHE.get(key)


def _pattern_phase_hours(when: Optional[str]) -> float:
    """Hours into the model's weekly pattern for a calendar timestamp.

    The demand patterns are weekly (2016 x 5-min slots = 7 days), so a window's
    hydraulic phase is its position in the week (Monday 00:00 = 0). 2018-01-01
    was a Monday, which makes the mapping trivial.
    """
    import pandas as pd
    ts = pd.to_datetime(when) if when else pd.Timestamp("2018-01-01 00:00:00")
    monday = ts.normalize() - pd.Timedelta(days=ts.weekday())
    return float(((ts - monday).total_seconds() / 3600.0) % 168.0)


def _fresh_model(hours: int, phase_hours: float):
    import wntr  # imported lazily — heavy dependency
    wn = wntr.network.WaterNetworkModel(str(_INP))
    wn.options.time.duration = int(hours * 3600)
    wn.options.time.pattern_start = int(phase_hours * 3600)
    return wn


def _run(wn) -> Tuple[Any, Any]:
    import wntr
    res = wntr.sim.EpanetSimulator(wn).run_sim()
    return res.link["flowrate"], res.node["pressure"]


def _snapshot(flow: Any, press: Any) -> Dict[str, Any]:
    """Full pipe-flow + node-pressure snapshot at the final step (CMH / m)."""
    pipes = {
        pid: {
            "flow": round(_cmh(float(flow[pid].iloc[-1])), 2),
            "abs": round(abs(_cmh(float(flow[pid].iloc[-1]))), 2),
        }
        for pid in flow.columns
    }
    nodes = {nid: {"pressure": round(float(press[nid].iloc[-1]), 2)} for nid in press.columns}
    return {"pipes": pipes, "nodes": nodes}


def _series(flow: Any, press: Any, every_hours: int = 1) -> Dict[str, List[float]]:
    """Key time series at 1-hour resolution (CMH / m)."""
    step = max(1, int(every_hours * 12))  # 12 rows/h at 5-min steps
    return {
        "p227": [round(_cmh(float(v)), 1) for v in flow["p227"][::step]],
        "p235": [round(_cmh(float(v)), 1) for v in flow["p235"][::step]],
        "PUMP_1": [round(_cmh(float(v)), 1) for v in flow["PUMP_1"][::step]],
        "T1_level_m": [round(float(v), 2) for v in press["T1"][::step]],
    }


def simulate_state(hours: int = 24, phase_hours: Optional[float] = None, when: Optional[str] = None) -> Dict[str, Any]:
    """Baseline hydraulics: the full pipe table at the final step + key series."""
    phase_hours = _pattern_phase_hours(when) if when else (float(phase_hours) % 168.0 if phase_hours is not None else 0.0)
    key = f"state:{int(hours)}:{round(phase_hours, 2)}"
    cached = _cache_get(key)
    if cached:
        return cached

    wn = _fresh_model(int(hours), phase_hours)
    flow, press = _run(wn)
    snap = _snapshot(flow, press)
    out = {
        "hours": int(hours),
        "phase_hours": round(phase_hours, 2),
        **snap,
        "series": _series(flow, press),
        "series_step_minutes": 60,
        "provenance": {
            "source": "L-TOWN_v2_Model.inp (official BattLeDIM EPANET model, KIOS Research) simulated with WNTR/EPANET",
            "note": "Typical-week hydraulics phase-aligned to the calendar week — model-estimated, not a replay of the 2018 measurements.",
        },
    }
    _cache_put(key, out)
    return out


def _add_leak_emitter(wn, node_id: str, leak_lph: float, pressure_m: float) -> float:
    """Attach an EPANET emitter to node_id sized so it discharges ~leak_lph at
    pressure_m (flow = k * P^0.5). wntr 1.5 attribute: emitter_coefficient."""
    k = _emitter_k(leak_lph, pressure_m)
    wn.get_node(node_id).emitter_coefficient = k
    return k


def _emitter_k(leak_lph: float, pressure_m: float) -> float:
    """EPANET emitter coefficient: flow = k * P^0.5 (SI, m3/s per sqrt(m)).

    leak_lph is LITRES/hour -> m3/s = (lph/1000)/3600."""
    p = max(pressure_m, 1.0)
    return ((leak_lph / 1000.0) / 3600.0) / (p ** _EMITTER_EXP)


def simulate_whatif(
    leak_pipe: str,
    leak_lph: float = 0.0,
    action: Optional[str] = None,
    throttle_target: float = 0.20,
    hours: int = 24,
    phase_hours: Optional[float] = None,
    when: Optional[str] = None,
) -> Dict[str, Any]:
    """Baseline vs leak vs leak+action, three real EPANET simulations.

    The leak is modelled ON the pipe: the pipe is split at its midpoint
    (wntr.morph.split_pipe), a junction is inserted there and an emitter sized
    from the SCADA excess-inflow estimate is attached. Isolating the pipe then
    means closing BOTH halves — which physically disconnects the leak — and
    throttling adds minor loss to both halves. This is the physically correct
    representation of a pipe leak, not a point leak at a sensor."""
    phase_hours = _pattern_phase_hours(when) if when else (float(phase_hours) % 168.0 if phase_hours is not None else 0.0)
    action = (action or "none").lower()
    hours = int(max(6, min(hours, 72)))
    key = f"whatif:{leak_pipe}:{round(leak_lph, 1)}:{action}:{round(throttle_target, 2)}:{hours}:{round(phase_hours, 2)}"
    cached = _cache_get(key)
    if cached:
        return cached

    # --- 1) baseline (unsplit, cached) -------------------------------------
    base = simulate_state(hours=hours, phase_hours=phase_hours)

    # --- 2) leak-only model: split the pipe, emitter at the midpoint -------
    import wntr as _wntr
    m_leak = _fresh_model(hours, phase_hours)
    if leak_pipe not in m_leak.link_name_list:
        raise ValueError(f"pipe '{leak_pipe}' not found in the EPANET model")
    m_leak = _wntr.morph.split_pipe(m_leak, leak_pipe, f"{leak_pipe}__s2", "leak_j", add_pipe_at_end=True, split_at_point=0.5)
    healthy_p = base["nodes"].get(_nearest_node_of(leak_pipe), {}).get("pressure", 30.0)
    k = _emitter_k(leak_lph, healthy_p) if leak_lph > 0 else None
    if k:
        m_leak.get_node("leak_j").emitter_coefficient = k
    f_leak, p_leak = _run(m_leak)
    p_leak_j = float(p_leak["leak_j"].iloc[-1])
    leak_lph_no_action = round(_cmh(k * (max(p_leak_j, 0.0) ** _EMITTER_EXP)), 1) if k else None

    # --- 3) leak + action --------------------------------------------------
    m_act = _fresh_model(hours, phase_hours)
    m_act = _wntr.morph.split_pipe(m_act, leak_pipe, f"{leak_pipe}__s2", "leak_j", add_pipe_at_end=True, split_at_point=0.5)
    if k:
        m_act.get_node("leak_j").emitter_coefficient = k
    note = None
    throttle_info = None
    if action == "isolate":
        for ln in (leak_pipe, f"{leak_pipe}__s2"):
            m_act.get_link(ln).initial_status = _wntr.network.LinkStatus.Closed
        note = f"Pipe {leak_pipe} closed (both halves) — the leak junction is fully isolated."
    elif action == "throttle":
        # Binary-search minor loss on both halves until flow through the leak
        # pipe drops by ~throttle_target vs the leak-only case.
        target_flow = float(f_leak[leak_pipe].iloc[-1]) * (1.0 - throttle_target)
        lo, hi, best_k = 0.0, 5000.0, 0.0
        for _ in range(6):
            mid = 0.5 * (lo + hi)
            probe = _fresh_model(hours, phase_hours)
            probe = _wntr.morph.split_pipe(probe, leak_pipe, f"{leak_pipe}__s2", "leak_j", add_pipe_at_end=True, split_at_point=0.5)
            if k:
                probe.get_node("leak_j").emitter_coefficient = k
            probe.get_link(leak_pipe).minor_loss = mid
            probe.get_link(f"{leak_pipe}__s2").minor_loss = mid
            f_probe, _ = _run(probe)
            if float(f_probe[leak_pipe].iloc[-1]) > target_flow:
                lo = mid
            else:
                hi = mid
            best_k = mid
        m_act.get_link(leak_pipe).minor_loss = best_k
        m_act.get_link(f"{leak_pipe}__s2").minor_loss = best_k
        throttle_info = {"minor_loss_k": round(best_k, 1), "target_reduction_pct": round(throttle_target * 100, 0)}
        note = f"Pipe {leak_pipe} throttled (minor loss k={best_k:.1f} on both halves) targeting a {throttle_target:.0%} flow reduction through it."
    f_act, p_act = _run(m_act)

    # --- leak delivered flow in each case ----------------------------------
    def _leak_flow_now(pdf):
        p_now = float(pdf["leak_j"].iloc[-1])
        return round(_cmh(k * (max(p_now, 0.0) ** _EMITTER_EXP)), 1) if k else None

    leak_lph_with_action = _leak_flow_now(p_act)
    leak_stopped = bool(
        leak_lph_no_action is not None
        and leak_lph_with_action is not None
        and leak_lph_with_action < 0.2 * max(leak_lph_no_action, 0.001)
    )

    # --- snapshot diff (service impact) ------------------------------------
    affected, losing_service = [], []
    for nid, b in base["nodes"].items():
        if nid not in p_act.columns:
            continue
        after_p = float(p_act[nid].iloc[-1])
        delta = after_p - b["pressure"]
        if delta <= -2.0:
            affected.append({"node": nid, "baseline_p": b["pressure"], "after_p": round(after_p, 2), "delta": round(delta, 2)})
        if after_p < 15.0 <= b["pressure"]:
            losing_service.append({"node": nid, "after_p": round(after_p, 2)})
    affected.sort(key=lambda x: x["delta"])

    # --- pipe-flow snapshot for the map (merge split halves back) ----------
    def _map_pipes(fdf):
        pipes = {}
        for pid in fdf.columns:
            base_id = pid[:-4] if pid.endswith("__s2") else pid
            v = _cmh(float(fdf[pid].iloc[-1]))
            pipes[base_id] = {
                "flow": round(pipes.get(base_id, {}).get("flow", 0.0) + v, 2),
                "abs": round(abs(pipes.get(base_id, {}).get("abs", 0.0) + abs(v)), 2),
            }
        return pipes

    def _inflow(fdf, i=-1) -> float:
        return round(_cmh(float(fdf["p227"].iloc[i]) + float(fdf["p235"].iloc[i]) + float(fdf["PUMP_1"].iloc[i])), 1)

    leak_j_press = {
        "with_leak": round(p_leak_j, 2),
        "with_action": round(float(p_act["leak_j"].iloc[-1]), 2),
    }

    out = {
        "action": action,
        "leak_pipe": leak_pipe,
        "hours": int(hours),
        "phase_hours": round(phase_hours, 2),
        "leak": {
            "pipe": leak_pipe,
            "junction": "leak_j",
            "target_lph": round(leak_lph, 0),
            "delivered_lph_no_action": leak_lph_no_action,
            "delivered_lph_with_action": leak_lph_with_action,
            "leak_stopped": leak_stopped,
            "junction_pressure_m": leak_j_press,
            "note": "Leak injected ON the pipe (midpoint junction via EPANET pipe split) as an emitter sized from the SCADA excess-inflow estimate; delivered flow follows the physics (k*sqrt(P)).",
        },
        "pipes_after_action": _map_pipes(f_act),
        "system_inflow_lph": {
            "baseline": round((base["series"]["p227"][-1] + base["series"]["p235"][-1] + base["series"]["PUMP_1"][-1]) * 1000, 0),
            "with_leak": round(_inflow(f_leak) * 1000, 0),
            "with_action": round(_inflow(f_act) * 1000, 0),
        },
        "pressure_impact": {
            "affected_node_count": len(affected),
            "affected_worst": affected[:12],
            "nodes_losing_service_count": len(losing_service),
            "nodes_losing_service": losing_service[:20],
            "threshold_note": "affected = pressure fell >= 2 m vs baseline; losing service = fell below 15 m",
        },
        "throttle": throttle_info,
        "note": note,
        "provenance": {
            "source": "L-TOWN_v2_Model.inp (official BattLeDIM EPANET model, KIOS Research) simulated with WNTR/EPANET",
            "note": "Three-simulation comparison (baseline / leak / leak+action) on the typical week phase-aligned to the event's calendar week. Deltas are model-computed physics; absolute values are model estimates.",
        },
    }
    _cache_put(key, out)
    return out


def _nearest_node_of(pipe: str) -> Optional[str]:
    """One endpoint node of the pipe (for a rough healthy-pressure estimate)."""
    try:
        wn = _fresh_model(6, 0.0)
        link = wn.get_link(pipe)
        return link.end_node_name
    except Exception:
        return None
