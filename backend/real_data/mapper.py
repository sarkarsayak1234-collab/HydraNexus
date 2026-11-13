"""Data mapper normalizing BattLeDIM 2018 L-Town SCADA records into HydraNexus format.

Preserves authentic sensor tags (p227, p235, PUMP_1, n1..n769) without fabricating
or forcing mappings into HydraNexus synthetic nodes.
"""
from __future__ import annotations
from typing import Dict, List, Any
import pandas as pd

from .schema import RealTelemetryPoint


def map_row_to_telemetry_point(
    flow_row: pd.Series,
    press_row: Optional[pd.Series] = None,
    leak_row: Optional[pd.Series] = None,
) -> RealTelemetryPoint:
    """Map merged series of flow, pressure, and leakage at a single timestamp to a RealTelemetryPoint."""
    timestamp = str(flow_row.get("Timestamp", ""))

    # Raw flow sensors
    flow_sensors: Dict[str, float] = {}
    for col in flow_row.index:
        if col != "Timestamp":
            try:
                flow_sensors[col] = round(float(flow_row[col]), 2)
            except (ValueError, TypeError):
                pass

    total_inflow = round(sum(flow_sensors.values()), 2)
    pump_flow = flow_sensors.get("PUMP_1", 0.0)

    # Raw pressure sensors
    press_sensors: Dict[str, float] = {}
    if press_row is not None:
        for col in press_row.index:
            if col != "Timestamp":
                try:
                    press_sensors[col] = round(float(press_row[col]), 2)
                except (ValueError, TypeError):
                    pass

    avg_pressure = round(sum(press_sensors.values()) / len(press_sensors), 2) if press_sensors else 0.0

    # Leakage ground-truth sensors
    active_leaks: List[str] = []
    total_leak_rate = 0.0
    if leak_row is not None:
        for col in leak_row.index:
            if col != "Timestamp":
                try:
                    val = float(leak_row[col])
                    if val > 0.0:
                        active_leaks.append(col)
                        total_leak_rate += val
                except (ValueError, TypeError):
                    pass

    total_leak_rate = round(total_leak_rate, 2)

    # NOTE: anomalyScore is intentionally NOT set here. The old code fabricated
    # a score from the ground-truth leakage column itself ("0.88 if active_leaks"),
    # which is using the answer key as the prediction. Real detection scores are
    # computed by real_data.detector (SCADA signals only) and attached in
    # processor.get_real_telemetry.

    return RealTelemetryPoint(
        time=timestamp,
        flow=total_inflow,
        pressure=avg_pressure,
        consumption=round(total_inflow - total_leak_rate, 2),
        pump_flow=pump_flow,
        flows=flow_sensors,
        pressures=press_sensors,
        active_leaks=active_leaks,
        leak_rate=total_leak_rate,
    )


def map_dataframe_to_telemetry_points(
    merged_df: pd.DataFrame,
    include_sensor_breakdown: bool = True,
) -> List[RealTelemetryPoint]:
    """Efficiently convert a sliced/downsampled DataFrame to list of RealTelemetryPoint objects."""
    points: List[RealTelemetryPoint] = []
    flow_cols = [c for c in ["p227", "p235", "PUMP_1"] if c in merged_df.columns]
    press_cols = [c for c in merged_df.columns if c.startswith("n") and c[1:].isdigit()]
    leak_cols = [c for c in merged_df.columns if c.startswith("p") and c not in flow_cols]

    for _, row in merged_df.iterrows():
        t = str(row["Timestamp"])

        # Flows
        flows = {c: round(float(row[c]), 2) for c in flow_cols if pd.notna(row[c])}
        total_inflow = round(sum(flows.values()), 2)
        pump_flow = flows.get("PUMP_1", 0.0)

        # Pressures
        if include_sensor_breakdown:
            pressures = {c: round(float(row[c]), 2) for c in press_cols if pd.notna(row[c])}
        else:
            # Sample key pressure sensors to keep payload compact
            sample_keys = ["n1", "n4", "n31", "n105", "n288", "n549", "n769"]
            pressures = {c: round(float(row[c]), 2) for c in sample_keys if c in row and pd.notna(row[c])}

        avg_pressure = round(sum(pressures.values()) / len(pressures), 2) if pressures else 0.0

        # Leaks
        active_leaks = [c for c in leak_cols if pd.notna(row[c]) and float(row[c]) > 0.0]
        leak_rate = round(sum(float(row[c]) for c in active_leaks), 2)

        # anomalyScore intentionally omitted — filled by the real detector in processor.

        points.append(
            RealTelemetryPoint(
                time=t,
                flow=total_inflow,
                pressure=avg_pressure,
                consumption=round(total_inflow - leak_rate, 2),
                pump_flow=pump_flow,
                flows=flows,
                pressures=pressures,
                active_leaks=active_leaks,
                leak_rate=leak_rate,
            )
        )

    return points
