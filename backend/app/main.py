"""HydraNexus FastAPI backend — AI-powered water decision intelligence (MVP).

Pipeline: Detect → Investigate → Verify → Assess → Simulate → Decide
Principle: software-first (simulated telemetry), human-in-the-loop (no autonomous control).
"""
from __future__ import annotations
from typing import Optional
from contextlib import asynccontextmanager
from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .schemas import DetectRequest, VerifyRequest, WhatIfRequest, DecisionCompareRequest
from .simulator import generate_telemetry, simulate_expected, rmse, to_dataframe
from .topology import graph_payload
from .ai import analyze, get_model
from . import db as incident_db
from . import decision as decision_engine

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Warm up the IsolationForest once so the first request is fast.
    get_model()
    yield


app = FastAPI(
    title="HydraNexus API",
    version="0.1.0",
    description="Software-first water infrastructure decision intelligence: Detect → Investigate → Verify → Assess → Simulate → Decide.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # hackathon MVP; restrict in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "hydranexus-api", "version": "0.1.0", "mode": "simulated",
            "db": "supabase" if incident_db.is_configured() else "mock"}


@app.get("/api/network/graph")
@app.get("/api/graph")
def network_graph(incidentActive: bool = False):
    return graph_payload(incident_active=incidentActive)


@app.get("/api/telemetry")
def telemetry(
    scenario: str = Query(default="normal", description="normal|leak|burst|demand|sensor"),
    points: int = Query(default=8, ge=4, le=48),
    seed: int = Query(default=7),
):
    data = generate_telemetry(scenario=scenario, points=points, seed=seed)
    return {"scenario": scenario.lower(), "points": len(data), "telemetry": data}


INCIDENT_HISTORY = [
    {"id": "INC-1048", "title": "Probable pipeline leak", "type": "Leak", "location": "B2 → B3",
     "zone": "Zone B", "started": "14:00 today", "status": "Investigating", "severity": "HIGH", "confidence": 76},
    {"id": "INC-1045", "title": "Possible demand spike", "type": "Demand", "location": "C1 → Zone C",
     "zone": "Zone C", "started": "12:40 today", "status": "Resolved", "severity": "MEDIUM", "confidence": 83},
    {"id": "INC-1039", "title": "Transient PRV oscillation", "type": "Valve", "location": "N1 Junction",
     "zone": "Zone A", "started": "Yesterday 09:15", "status": "Resolved", "severity": "LOW", "confidence": 91},
]


@app.get("/api/incidents")
def incidents():
    rows = incident_db.get_incidents()
    if rows:
        return {"incidents": rows, "source": "supabase"}
    return {"incidents": INCIDENT_HISTORY, "source": "mock"}


@app.post("/api/incidents")
def create_incident(item: dict):
    ok = incident_db.save_incident(item)
    if not ok:
        raise HTTPException(status_code=503, detail="incident store unavailable (no SUPABASE env or DB unreachable)")
    return {"saved": True, "id": item.get("id")}


@app.post("/api/ai/detect")
def ai_detect(body: DetectRequest):
    try:
        result = analyze([p.model_dump() for p in body.telemetry])
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    # Auto-file HIGH/MEDIUM anomalies + corrosion watch to Supabase
    # (fire-and-forget, never breaks demo).
    try:
        if result.get("severity") in ("HIGH", "MEDIUM") or result.get("primaryHypothesis") == "Early Corrosion":
            import datetime
            ist = datetime.timezone(datetime.timedelta(hours=5, minutes=30))
            now_ist = datetime.datetime.now(ist)
            loc = result.get("location", {})
            hyp = result.get("primaryHypothesis", "Leak")
            type_map = {"Confirmed Leak": "Leak", "Confirmed Burst": "Burst",
                        "Pipeline Leak": "Leak", "Pipe Burst": "Burst",
                        "Demand Spike": "Demand", "Sensor Fault": "Sensor",
                        "Early Corrosion": "Corrosion", "Valve Issue": "Valve",
                        "Normal Operation": "Normal"}
            pipe = result.get("pipeCondition", {})
            incident_db.save_incident({
                "id": f"INC-{datetime.datetime.utcnow().strftime('%Y%m%d%H%M%S')}",
                "title": f"Probable {hyp.lower()}",
                "type": type_map.get(hyp, "Leak"),
                "location": loc.get("segment", "B2 → B3"),
                "zone": f"Zone {loc.get('zone', 'B')}",
                "severity": result.get("severity"),
                "status": "Investigating",
                "confidence": result.get("confidence"),
                "lossPerHour": result.get("impact", {}).get("lossPerHour"),
                "started": now_ist.strftime("%H:%M IST"),
                "evidence": result.get("evidence", [])[:6],
                "eddyVariance": result.get("latest", {}).get("eddy_current_variance"),
                "pipeState": pipe.get("state"),
            })
    except Exception:
        pass
    return result


@app.get("/api/ai/alerts")
def ai_alerts(scenario: str = Query(default="leak"), points: int = Query(default=8, ge=4, le=48)):
    """Convenience: generate a scenario window then run the full AI pipeline."""
    data = generate_telemetry(scenario=scenario, points=points)
    result = analyze(data)
    return {"scenario": scenario.lower(), "telemetry": data, "analysis": result}


@app.get("/api/impact")
def impact(scenario: str = Query(default="leak"), points: int = Query(default=8, ge=4, le=48)):
    data = generate_telemetry(scenario=scenario, points=points)
    result = analyze(data)
    return {"scenario": scenario.lower(), "impact": result["impact"], "severity": result["severity"],
            "location": result["location"], "evidence": result["evidence"],
            "pipeCondition": result["pipeCondition"],
            "primaryHypothesis": result["primaryHypothesis"]}


WHATIF_CATALOG = {
    "isolate": {"label": "Isolate B2 → B3 (Valve Closure 100%)",
                "before": {"loss": 3500, "pressure": 3.3, "users": 0},
                "after": {"loss": 300, "pressure": 3.0, "users": 120},
                "notes": "Maximizes loss reduction (91.4% saved), but isolates 120 customer connections in Zone B until bypass is engaged."},
    "reducePressure": {"label": "Throttle PRV (Pressure Drop to 3.0 bar)",
                "before": {"loss": 3500, "pressure": 3.3, "users": 0},
                "after": {"loss": 1575, "pressure": 3.15, "users": 0},
                "notes": "Cuts leakage rate by ~55% while maintaining minimum service pressure for all connected customers."},
    "bypassRoute": {"label": "Reroute via Parallel Sub-main B1-Alt",
                "before": {"loss": 3500, "pressure": 3.3, "users": 0},
                "after": {"loss": 450, "pressure": 3.8, "users": 15},
                "notes": "Maintains 97% supply pressure and isolates leak, requires opening manual valve V-42."},
    "doNothing": {"label": "Do Nothing (Monitor baseline)",
                "before": {"loss": 3500, "pressure": 3.3, "users": 0},
                "after": {"loss": 3500, "pressure": 3.3, "users": 0},
                "notes": "Continuous loss of 3,500 L/hr (84,000 L/day) leading to potential ground erosion."},
}


@app.post("/api/verify")
def verify(body: VerifyRequest):
    """Scenario verification: compare observed anomaly vs simulated hypothesis.

    Returns evidence strength (0..100). High score => observed matches hypothesis.
    """
    hypothesis = (body.hypothesis or "leak").lower()
    if hypothesis not in ("leak", "burst", "demand", "sensor", "corrosion", "normal"):
        hypothesis = "leak"
    observed = [p.model_dump() for p in body.observed]
    if len(observed) < 3:
        raise HTTPException(status_code=400, detail="observed window needs >= 3 points")
    expected = simulate_expected(hypothesis, points=len(observed))
    # Compare normalized flow+pressure trajectories
    import math
    of = [o["flow"] / 8000.0 for o in observed]
    ef = [e["flow"] / 8000.0 for e in expected]
    op = [o["pressure"] / 4.0 for o in observed]
    ep = [e["pressure"] / 4.0 for e in expected]
    flow_rmse = rmse(of, ef)
    press_rmse = rmse(op, ep)
    combined = 0.6 * flow_rmse + 0.4 * press_rmse
    # Map RMSE (~0 good, ~0.5 bad) to 0..100
    match = max(0.0, min(100.0, 100.0 * math.exp(-4.5 * combined)))
    verified = match >= 60.0
    return {
        "hypothesis": hypothesis,
        "segment": body.segment,
        "matchScore": round(match, 1),
        "verified": verified,
        "flowRmse": round(flow_rmse, 4),
        "pressureRmse": round(press_rmse, 4),
        "evidenceStrength": "STRONG" if match >= 75 else "MODERATE" if match >= 60 else "WEAK",
        "simulated": expected,
        "explanation": (
            f"Observed trajectory matches a simulated {hypothesis} at {body.segment} "
            f"with {match:.1f}% similarity. {'Hypothesis SUPPORTED — proceed to impact assessment.' if verified else 'Hypothesis WEAK — consider alternative causes.'}"
        ),
        "operatorNote": "Verification is advisory only; operator approval required before any intervention.",
    }


def compute_whatif_result(scenario_key: str, incident: str = "leak",
                          baseline_loss: float | None = None,
                          valve_throttle: float = 50.0) -> dict:
    """Reusable single-scenario simulation (shared by /api/whatif and /api/decision/compare)."""
    key = scenario_key or "isolate"
    if key not in WHATIF_CATALOG:
        raise ValueError(f"unknown scenario '{key}'. Choose {sorted(WHATIF_CATALOG)}")
    incident = (incident or "leak").lower()
    incident_defaults = {"leak": 3500, "burst": 7000, "demand": 0, "sensor": 0,
                         "corrosion": 0, "normal": 0}
    if incident in ("demand", "sensor", "corrosion", "normal"):
        base = 0.0
    elif baseline_loss is not None:
        base = max(0.0, float(baseline_loss))
    else:
        base = float(incident_defaults.get(incident, 3500))
    item = WHATIF_CATALOG[key]
    scale = base / 3500.0 if base > 0 else 0.0
    before = {**item["before"], "loss": round(base)}
    if base <= 0:
        after = {**item["after"], "loss": 0}
        if incident == "corrosion":
            notes = (
                "Wall degradation without a breach — no water loss yet. "
                f"{item['label']} would disrupt {item['after']['users']} users with 0 L/hr saved. "
                "Schedule inspection instead of isolation."
            )
        else:
            notes = (
                f"No pipe water-loss for '{incident}' — metered use or sensor error, not leakage. "
                f"{item['label']} would disrupt {item['after']['users']} users with 0 L/hr saved. Monitoring recommended."
                if item["after"]["users"] > 0 else
                f"No pipe water-loss for '{incident}'. {item['label']} saves 0 L/hr. Monitoring recommended."
            )
        return {
            "scenario": key,
            "incident": incident,
            "label": item["label"],
            "before": before,
            "after": after,
            "lossReductionPct": 0.0,
            "notes": notes,
            "operatorNote": "Simulation is advisory. Human operator decides and remains accountable.",
        }
    after_loss = round(item["after"]["loss"] * scale)
    # PRV throttle interpolates loss (mirrors frontend WhatIfPage logic)
    if key == "reducePressure":
        throttle = max(0.0, min(100.0, float(valve_throttle if valve_throttle is not None else 50)))
        factor = (100 - throttle) / 100.0
        after_loss = round(base * (0.45 + factor * 0.55))
    before_loss = round(base)
    reduction = round((before_loss - after_loss) / before_loss * 100, 1) if before_loss else 0.0
    return {
        "scenario": key,
        "incident": incident,
        "label": item["label"],
        "before": before,
        "after": {**item["after"], "loss": after_loss},
        "lossReductionPct": reduction,
        "notes": item["notes"] + f" Scaled to {incident} baseline ({before_loss:,} L/hr).",
        "operatorNote": "Simulation is advisory. Human operator decides and remains accountable.",
    }


@app.post("/api/whatif")
def whatif(body: WhatIfRequest):
    """Single-scenario simulation (unchanged behavior; now shares compute_whatif_result)."""
    try:
        return compute_whatif_result(body.scenario or "isolate", body.incident or "leak",
                                     body.baselineLoss, body.valveThrottle or 50)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/whatif/options")
def whatif_options():
    return {"options": WHATIF_CATALOG}


@app.get("/api/decision/config")
def decision_config():
    """Configurable planning costs + trade-off weights for the decision engine."""
    return decision_engine.config_payload()


@app.post("/api/decision/compare")
def decision_compare(body: DecisionCompareRequest):
    """Cost-aware comparison of Isolate / Throttle / Reroute / Do Nothing.

    Reuses the existing What-If simulations, scores the trade-off, ranks the
    options and explains the recommendation. Advisory only — never executes.
    """
    incident = (body.incident or "leak").lower()
    severity = (body.severity or "HIGH").upper()
    if severity not in ("HIGH", "MEDIUM", "LOW", "NORMAL"):
        severity = "HIGH"
    segment = body.segment or "B2 → B3"
    throttle = float(body.valveThrottle if body.valveThrottle is not None else 50)
    incident_defaults = {"leak": 3500, "burst": 7000, "demand": 0, "sensor": 0,
                         "corrosion": 0, "normal": 0}
    if body.baselineLoss is not None:
        baseline = max(0.0, float(body.baselineLoss))
    else:
        baseline = float(incident_defaults.get(incident, 3500))
    sims: dict[str, dict] = {}
    for scenario_key in ("isolate", "reducePressure", "bypassRoute", "doNothing"):
        sims[scenario_key] = compute_whatif_result(scenario_key, incident, baseline, throttle)
    result = decision_engine.compare_options(
        incident=incident, severity=severity, segment=segment,
        baseline_loss=baseline, whatif_results=sims,
        weights=body.weights, costs=body.costs,
    )
    result["simulations"] = sims
    return result


# ---------------------------------------------------------------------------
# Real Data Mode (BattLeDIM 2018 L-Town Benchmark)
# ---------------------------------------------------------------------------

@app.get("/api/real-data/metadata")
def real_data_metadata():
    """Retrieve metadata, sensor inventories, and historical leakage summary for real SCADA dataset."""
    try:
        from real_data import get_metadata
        return get_metadata().model_dump()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load real data metadata: {str(e)}")


@app.get("/api/real-data/leakages")
def real_data_leakages():
    """Retrieve all 14 historical ground-truth leakage episodes from 2018_Leakages.csv."""
    try:
        from real_data import get_leakage_events
        events = get_leakage_events()
        return {"count": len(events), "events": [e.model_dump() for e in events]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load leakage events: {str(e)}")


@app.get("/api/real-data/telemetry")
def real_data_telemetry(
    start: Optional[str] = Query(default=None, description="Start timestamp YYYY-MM-DD HH:MM:SS"),
    end: Optional[str] = Query(default=None, description="End timestamp YYYY-MM-DD HH:MM:SS"),
    points: int = Query(default=24, ge=4, le=200, description="Max points to return (downsampled if window is larger)"),
    event_pipe: Optional[str] = Query(default=None, description="Pipe ID to center telemetry window on an active leak"),
):
    """Retrieve windowed and downsampled real telemetry from BattLeDIM 2018 SCADA feeds."""
    try:
        from real_data import get_real_telemetry
        return get_real_telemetry(start=start, end=end, points=points, event_pipe=event_pipe).model_dump()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to slice real telemetry: {str(e)}")

