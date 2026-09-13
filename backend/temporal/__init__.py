"""Temporal Intelligence package for HydraNexus.

Analyzes recent telemetry behavior (lags, rolling baselines, trends,
persistence, cross-signal relationships) instead of relying only on a single
sensor reading. Every computation is causal: at timestamp T only data at or
before T is used — never future readings.

Works on any ordered telemetry window (simulation hourly feed and L-Town 5-min
SCADA alike). Pure statistics — no trained model inside, so it is safe to run
on real SCADA without a simulation-trained model.
"""
from .feature_engine import analyze_temporal

__all__ = ["analyze_temporal"]
