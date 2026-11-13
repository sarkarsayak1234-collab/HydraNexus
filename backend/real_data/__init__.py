"""Real Data package for HydraNexus — runtime handling of BattLeDIM 2018 benchmark datasets."""
from .schema import (
    RealDataMetadata,
    LeakageEventSummary,
    RealTelemetryPoint,
    RealTelemetryResponse,
)
from .loader import (
    get_metadata,
    get_leakage_events,
    get_flows_df,
    get_pressures_df,
    get_leakages_df,
)
from .processor import get_real_telemetry
from .detector import score_frame, analyze_real, model_info, get_reference
from .evaluate import run_benchmark

__all__ = [
    "RealDataMetadata",
    "LeakageEventSummary",
    "RealTelemetryPoint",
    "RealTelemetryResponse",
    "get_metadata",
    "get_leakage_events",
    "get_flows_df",
    "get_pressures_df",
    "get_leakages_df",
    "get_real_telemetry",
    "score_frame",
    "analyze_real",
    "model_info",
    "get_reference",
    "run_benchmark",
]
