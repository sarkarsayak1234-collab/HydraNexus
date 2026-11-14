"""Live Replay for BattLeDIM 2018 (R4) — accelerated-time episode playback.

Serves everything the frontend player needs in ONE request so playback is a
pure frontend animation (robust on free-tier cold instances):

- a native 5-minute-resolution window around the chosen leak episode
  ([start - 2h, start + 10h] -> the leak begins ~2h into the story);
- the SAME causal baseline (14 days of pre-window SCADA only) the ground-truth
  benchmark uses, so the alarm fires in the replay exactly when the benchmark
  says it fired;
- per-step detector verdicts (alarm / sustained / reacting sensor / z-scores)
  computed by the frozen rule — ground truth is NEVER an input;
- the answer-key episode meta in a clearly-labelled overlay, used only to
  compute the displayed detection latency ("leak started (answer key) at ...").
"""
from __future__ import annotations

import threading
from typing import Any, Dict, Optional

import numpy as np
import pandas as pd

from .detector import (
    build_hour_stats,
    get_reference,
    score_frame,
    _hour_lookup,
    _hour_of,
    model_info,
)
from .loader import get_leakages_df
from . import evaluate as ev

_LOCK = threading.RLock()
_MERGED: Optional[pd.DataFrame] = None
_REPLAY_CACHE: Dict[str, Dict[str, Any]] = {}

_REPLAY_PRE_HOURS = 2.0   # normal-operation runway before the leak starts
_REPLAY_POST_HOURS = 10.0 # detection horizon after the leak starts
_MAX_STEPS = 200          # 12h at native 5-min resolution = 145 steps + headroom


def _get_merged() -> pd.DataFrame:
    global _MERGED
    with _LOCK:
        if _MERGED is None:
            _MERGED = ev._merged_frame()
        return _MERGED


def _pick_episode(pipe: str) -> Optional[Dict[str, Any]]:
    """The episode to replay for a pipe: prefer the largest EVENT-tier run."""
    leak_df = get_leakages_df()
    episodes = [e for e in ev._classify(ev._split_runs(leak_df)) if e["pipe"].lower() == pipe.lower()]
    if not episodes:
        return None
    events = [e for e in episodes if e["kind"] == "event"]
    pool = events or episodes
    return max(pool, key=lambda e: e["max_rate"])


def build_replay(pipe: str, force: bool = False) -> dict:
    """Build (and cache) the replay payload for a leak pipe."""
    key = pipe.lower()
    with _LOCK:
        if not force and key in _REPLAY_CACHE:
            return _REPLAY_CACHE[key]

        episode = _pick_episode(pipe)
        if episode is None:
            raise ValueError(f"no leak episode found for pipe '{pipe}' in the BattLeDIM ground truth")

        ref = get_reference()
        merged = _get_merged()
        w_start = episode["start"] - pd.Timedelta(hours=_REPLAY_PRE_HOURS)
        w_end = episode["start"] + pd.Timedelta(hours=_REPLAY_POST_HOURS)

        mask = (merged["Timestamp"] >= w_start.strftime("%Y-%m-%d %H:%M:%S")) & (
            merged["Timestamp"] <= w_end.strftime("%Y-%m-%d %H:%M:%S")
        )
        sub = merged[mask]
        if len(sub) > _MAX_STEPS:
            step = int(np.ceil(len(sub) / _MAX_STEPS))
            sub = sub.iloc[::step]
        if len(sub) < 12:
            raise ValueError("replay window is empty for this episode")

        causal, causal_note = ev._causal_stats(merged, ref, w_start)
        scored = score_frame(sub, stats=causal).reset_index(drop=True)

        times = sub["Timestamp"].tolist()
        hours = np.array([_hour_of(str(t)) for t in times], dtype=int)
        flow_med, _ = _hour_lookup(causal["flow"] if causal else ref.stats["flow"], hours)
        press_med, _ = _hour_lookup(
            (causal or ref.stats)["press_avg"], hours
        )

        flows = sub[ref.flow_sensors].apply(pd.to_numeric, errors="coerce")
        flows = flows.where(flows > 0)
        total_flow = flows.sum(axis=1, skipna=True).to_numpy(dtype=float)
        presses = sub[ref.press_sensors].apply(pd.to_numeric, errors="coerce").where(lambda d: d > 0)
        press_avg = presses.mean(axis=1, skipna=True).to_numpy(dtype=float)

        steps = []
        for i in range(len(sub)):
            steps.append({
                "time": str(times[i]),
                "flow": round(float(total_flow[i]), 1) if np.isfinite(total_flow[i]) else None,
                "press_avg": round(float(press_avg[i]), 2) if np.isfinite(press_avg[i]) else None,
                "flow_typical": round(float(flow_med[i]), 1) if np.isfinite(flow_med[i]) else None,
                "press_typical": round(float(press_med[i]), 1) if np.isfinite(press_med[i]) else None,
                "z_flow": float(scored["z_flow"].iloc[i]),
                "press_vote": int(scored["press_vote"].iloc[i]),
                "alarm": bool(scored["alarm"].iloc[i]),
                "sustained": bool(scored["sustained_alarm"].iloc[i]),
                "reacted_sensor": scored["reacted_sensor"].iloc[i] or None,
                "score": float(scored["anomaly_score"].iloc[i]),
            })

        start_ts = pd.to_datetime(times[0])
        leak_start = episode["start"]
        first_sustained_idx = next(
            (i for i, s in enumerate(steps) if s["sustained"]), None
        )
        first_after_leak_idx = next(
            (
                i for i, s in enumerate(steps)
                if s["sustained"] and pd.to_datetime(s["time"]) >= leak_start
            ),
            None,
        )
        pre_alarm_idx = (
            first_sustained_idx
            if first_sustained_idx is not None and first_after_leak_idx is None
            else None
        )
        detection_idx = first_after_leak_idx
        latency_min = (
            round((pd.to_datetime(steps[detection_idx]["time"]) - leak_start).total_seconds() / 60.0, 1)
            if detection_idx is not None
            else None
        )

        payload = {
            "dataset": "BattLeDIM 2018 L-Town Benchmark",
            "window": {
                "start": steps[0]["time"],
                "end": steps[-1]["time"],
                "steps": len(steps),
                "step_seconds": 300,
                "leak_start_step": int(
                    max(0, np.searchsorted([pd.to_datetime(s["time"]) for s in steps], leak_start))
                ),
            },
            "episode": {
                "pipe": episode["pipe"],
                "kind": episode["kind"],
                "start": episode["start"].strftime("%Y-%m-%d %H:%M:%S"),
                "end": episode["end"].strftime("%Y-%m-%d %H:%M:%S"),
                "max_rate_m3h": episode["max_rate"],
                "avg_rate_m3h": episode["avg_rate"],
                "duration_hours": episode["duration_hours"],
            },
            "answer_key_note": (
                "Episode timing comes from the published BattLeDIM answer key and is shown ONLY to timestamp "
                "the story and compute detection latency. The detector itself sees SCADA signals only."
            ),
            "detection": {
                "detected": detection_idx is not None,
                "alarm_step_index": detection_idx,
                "alarm_time": steps[detection_idx]["time"] if detection_idx is not None else None,
                "latency_min": latency_min,
                "pre_alarm_step_index": pre_alarm_idx,
                "reacted_sensor": steps[detection_idx]["reacted_sensor"] if detection_idx is not None else None,
            },
            "baseline_source": causal_note,
            "model": model_info(),
            "steps": steps,
        }
        _REPLAY_CACHE[key] = payload
        return payload


def replay_pipes() -> list[str]:
    """Pipes that have a replayable episode (any tier)."""
    leak_df = get_leakages_df()
    return sorted({e["pipe"] for e in ev._split_runs(leak_df)})
