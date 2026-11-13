"""Telemetry processing, window slicing, and downsampling engine for Real Data Mode.

Ensures real datasets (105,120 rows) are queried efficiently in memory and that
only appropriately sized telemetry payloads (e.g., 24–100 points) are sent over the network.
"""
from __future__ import annotations
import math
from typing import Optional, Tuple
import pandas as pd

from .loader import get_flows_df, get_pressures_df, get_leakages_df, get_leakage_events
from .mapper import map_dataframe_to_telemetry_points
from .schema import RealTelemetryResponse, LeakageEventSummary
from .detector import score_frame


def get_real_telemetry(
    start: Optional[str] = None,
    end: Optional[str] = None,
    points: int = 24,
    event_pipe: Optional[str] = None,
) -> RealTelemetryResponse:
    """Slice, merge, and downsample real BattLeDIM 2018 telemetry for frontend delivery.

    Args:
        start: Optional start timestamp 'YYYY-MM-DD HH:MM:SS'.
        end: Optional end timestamp 'YYYY-MM-DD HH:MM:SS'.
        points: Number of points requested (clamped between 4 and 200).
        event_pipe: Optional pipe ID to automatically focus on an active leakage episode.
    """
    points = max(4, min(points, 200))
    events = get_leakage_events()
    matched_event: Optional[LeakageEventSummary] = None

    # If an event_pipe is specified, focus window on that leak
    if event_pipe:
        for ev in events:
            if ev.pipe.lower() == event_pipe.lower():
                matched_event = ev
                break

    if matched_event:
        # 12 hours before leak start to 12 hours after leak start
        start_ts = pd.to_datetime(matched_event.start_time)
        w_start = (start_ts - pd.Timedelta(hours=6)).strftime("%Y-%m-%d %H:%M:%S")
        w_end = (start_ts + pd.Timedelta(hours=18)).strftime("%Y-%m-%d %H:%M:%S")
        start = start or w_start
        end = end or w_end

    # Default window: First high-impact event (p232, Feb 2018 burst episode) if no range given
    if not start or not end:
        default_event = events[0] if events else None
        if default_event:
            matched_event = default_event
            start_ts = pd.to_datetime(default_event.start_time)
            start = (start_ts - pd.Timedelta(hours=4)).strftime("%Y-%m-%d %H:%M:%S")
            end = (start_ts + pd.Timedelta(hours=20)).strftime("%Y-%m-%d %H:%M:%S")
        else:
            start = "2018-01-01 00:00:00"
            end = "2018-01-02 00:00:00"

    flows_df = get_flows_df()
    press_df = get_pressures_df()
    leak_df = get_leakages_df()

    # Fast boolean indexing on string timestamps (lexicographically valid since format is YYYY-MM-DD HH:MM:SS)
    mask = (flows_df["Timestamp"] >= start) & (flows_df["Timestamp"] <= end)
    f_sub = flows_df[mask]

    # Fallback to head if window yielded nothing
    if f_sub.empty:
        f_sub = flows_df.head(points)
        start = str(f_sub["Timestamp"].iloc[0])
        end = str(f_sub["Timestamp"].iloc[-1])

    # Direct index-aligned slice across all three dataframes
    p_sub = press_df.loc[f_sub.index].drop(columns=["Timestamp"], errors="ignore")
    l_sub = leak_df.loc[f_sub.index].drop(columns=["Timestamp"], errors="ignore")

    merged = pd.concat([f_sub, p_sub, l_sub], axis=1)

    total_sliced = len(merged)
    downsampled = False

    # Downsample if sliced rows exceed requested points
    if total_sliced > points:
        step = math.ceil(total_sliced / points)
        merged = merged.iloc[::step].head(points)
        downsampled = True

    telemetry_points = map_dataframe_to_telemetry_points(merged, include_sensor_breakdown=True)

    # ------------------------------------------------------------------
    # Attach REAL detector scores (SCADA signals only — the ground-truth
    # leakage columns in `merged` are ignored by score_frame). This replaces
    # the old fabricated anomaly scores that derived from the answer key.
    # ------------------------------------------------------------------
    try:
        scored = score_frame(merged).reset_index(drop=True)
        if len(scored) == len(telemetry_points):
            for i, tp in enumerate(telemetry_points):
                row = scored.iloc[i]
                tp.anomalyScore = round(float(row["anomaly_score"]), 3)
                tp.alarm = bool(row["sustained_alarm"])
                tp.reacted_sensor = row["reacted_sensor"]
    except Exception:
        # Scoring must never break the telemetry endpoint — points stay unscored.
        pass

    return RealTelemetryResponse(
        mode="real",
        dataset="BattLeDIM 2018 L-Town Benchmark",
        start=start,
        end=end,
        points=len(telemetry_points),
        downsampled=downsampled,
        active_event=matched_event,
        telemetry=telemetry_points,
    )
