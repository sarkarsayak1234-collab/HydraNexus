"""Smoke tests for HydraNexus API (run: python -m pytest test_api.py -q or python test_api.py)."""
from fastapi.testclient import TestClient
from app.main import app
from app.simulator import generate_telemetry

client = TestClient(app)


def test_health():
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"


def test_graph():
    r = client.get("/api/network/graph")
    j = r.json()
    assert len(j["nodes"]) == 8 and len(j["edges"]) == 7
    assert "tanks" in j and len(j["tanks"]) == 2


def test_telemetry_scenarios():
    for s in ["normal", "leak", "burst", "demand", "sensor", "corrosion"]:
        r = client.get(f"/api/telemetry?scenario={s}&points=8")
        assert r.status_code == 200 and len(r.json()["telemetry"]) == 8


def test_eddy_fusion_tracks():
    leak = generate_telemetry("leak")
    assert leak[-1]["eddy_current_variance"] >= 0.7  # physical crack
    burst = generate_telemetry("burst")
    assert burst[-1]["eddy_current_variance"] >= 0.8
    sensor = generate_telemetry("sensor", points=8)
    assert max(p["eddy_current_variance"] for p in sensor) < 0.15  # healthy wall
    corr = generate_telemetry("corrosion", points=8)
    assert corr[-1]["eddy_current_variance"] > corr[0]["eddy_current_variance"]  # creeping rise
    assert abs(corr[-1]["pressure"] - 4.0) < 0.3  # hydraulics normal


def test_fusion_truth_table():
    from app.ai import analyze
    leak = analyze(generate_telemetry("leak"))
    assert leak["primaryHypothesis"] == "Confirmed Leak"
    assert leak["pipeCondition"]["state"] == "Crack"
    burst = analyze(generate_telemetry("burst"))
    assert burst["primaryHypothesis"] == "Confirmed Burst"
    sensor = analyze(generate_telemetry("sensor"))
    assert sensor["primaryHypothesis"] == "Sensor Fault"
    assert sensor["pipeCondition"]["state"] == "Healthy"
    assert sensor["impact"]["lossPerHour"] == 0.0
    corr = analyze(generate_telemetry("corrosion"))
    assert corr["primaryHypothesis"] == "Early Corrosion"
    assert corr["impact"]["lossPerHour"] == 0.0


def test_detect_leak():
    data = generate_telemetry("leak")
    r = client.post("/api/ai/detect", json={"telemetry": data})
    j = r.json()
    assert j["anomaly"] is True
    assert j["severity"] in ("HIGH", "MEDIUM")
    assert j["location"]["segment"] == "B2 → B3"
    assert j["impact"]["lossPerHour"] > 1000


def test_detect_burst():
    data = generate_telemetry("burst")
    r = client.post("/api/ai/detect", json={"telemetry": data})
    j = r.json()
    assert j["anomaly"] is True
    assert j["severity"] == "HIGH"
    assert j["primaryHypothesis"] == "Confirmed Burst"
    assert "explanation" in j
    assert j["explanation"]["diagnosis"]["primary"] == "Confirmed Burst"
    assert "pipe burst" in j["explanation"]["summary"].lower()


def test_detect_normal():
    data = generate_telemetry("normal")
    r = client.post("/api/ai/detect", json={"telemetry": data})
    j = r.json()
    assert j["severity"] in ("NORMAL", "LOW")


def test_verify():
    observed = generate_telemetry("leak")
    r = client.post("/api/verify", json={"observed": observed, "hypothesis": "leak", "segment": "B2 → B3"})
    j = r.json()
    assert j["matchScore"] > 60 and j["verified"] is True
    # Corrosion hypothesis is accepted and self-matches.
    obs_c = generate_telemetry("corrosion")
    r = client.post("/api/verify", json={"observed": obs_c, "hypothesis": "corrosion", "segment": "B2 → B3"})
    assert r.json()["hypothesis"] == "corrosion"


def test_whatif():
    r = client.post("/api/whatif", json={"scenario": "isolate"})
    assert r.json()["lossReductionPct"] > 80
    r = client.post("/api/whatif", json={"scenario": "reducePressure", "valveThrottle": 50})
    assert r.status_code == 200
    # Scenario-aware scaling: burst baseline is larger than leak
    r_leak = client.post("/api/whatif", json={"scenario": "isolate", "incident": "leak"})
    r_burst = client.post("/api/whatif", json={"scenario": "isolate", "incident": "burst"})
    assert r_burst.json()["before"]["loss"] > r_leak.json()["before"]["loss"]
    # Demand has no pipe loss
    r_dem = client.post("/api/whatif", json={"scenario": "isolate", "incident": "demand"})
    assert r_dem.json()["before"]["loss"] == 0 and r_dem.json()["lossReductionPct"] == 0.0
    # Corrosion watch: no loss yet, inspection note instead of isolation math
    r_cor = client.post("/api/whatif", json={"scenario": "isolate", "incident": "corrosion"})
    assert r_cor.json()["before"]["loss"] == 0 and "inspection" in r_cor.json()["notes"].lower()


def test_decision_config():
    r = client.get("/api/decision/config")
    j = r.json()
    assert r.status_code == 200
    assert len(j["actions"]) == 4
    assert set(j["costs"]) == {"isolate", "throttle", "reroute", "do_nothing"}
    assert abs(sum(j["default_weights"].values()) - 1.0) < 0.01
    assert "planning estimates" in j["cost_basis"].lower()


def test_decision_compare_leak():
    r = client.post("/api/decision/compare", json={"incident": "leak", "severity": "HIGH"})
    assert r.status_code == 200
    j = r.json()
    assert len(j["options"]) == 4
    scores = [o["score"] for o in j["options"]]
    assert scores == sorted(scores, reverse=True)
    assert [o["rank"] for o in j["options"]] == [1, 2, 3, 4]
    assert all(0 <= s <= 100 for s in scores)
    assert j["recommended_action"] == j["options"][0]["action"]
    assert len(j["why"]) >= 3 and len(j["reason"]) > 20
    assert "simulations" in j and set(j["simulations"]) == {"isolate", "reducePressure", "bypassRoute", "doNothing"}
    assert j["operatorNote"] and "no intervention is executed" in j["operatorNote"].lower()
    for o in j["options"]:
        for field in ("water_loss_reduction", "risk_reduction", "affected_users",
                      "service_disruption", "estimated_cost_usd", "network_impact", "score"):
            assert field in o, f"missing {field} in {o['action']}"


def test_decision_compare_sensor_prefers_monitoring():
    r = client.post("/api/decision/compare", json={"incident": "sensor", "severity": "LOW"})
    j = r.json()
    assert r.status_code == 200
    assert j["recommended_action"] == "do_nothing"
    assert all(o["water_loss_reduction"] == 0 for o in j["options"])


def test_decision_compare_throttle_and_weights():
    r_lo = client.post("/api/decision/compare", json={"incident": "leak", "valveThrottle": 10})
    r_hi = client.post("/api/decision/compare", json={"incident": "leak", "valveThrottle": 90})
    lo_throttle = next(o for o in r_lo.json()["options"] if o["action"] == "throttle")
    hi_throttle = next(o for o in r_hi.json()["options"] if o["action"] == "throttle")
    assert hi_throttle["water_loss_reduction"] > lo_throttle["water_loss_reduction"]
    r = client.post("/api/decision/compare",
                    json={"incident": "leak", "weights": {"water": 0.5, "risk": 0.3, "service": 0.1, "cost": 0.05, "disruption": 0.05}})
    assert r.status_code == 200 and len(r.json()["options"]) == 4


def test_incidents_fallback():
    # Without SUPABASE env locally, must fall back to mock list (demo never breaks).
    r = client.get("/api/incidents")
    j = r.json()
    assert r.status_code == 200 and len(j["incidents"]) >= 3
    assert j.get("source") in ("mock", "supabase")


def _explanation_for(scenario):
    from app.ai import analyze
    result = analyze(generate_telemetry(scenario))
    expl = result["explanation"]
    # Existing response keys are preserved alongside the new explanation.
    assert result["primaryHypothesis"] == expl["diagnosis"]["primary"]
    assert result["confidence"] == expl["confidence"] == expl["diagnosis"]["confidence"]
    assert result["severity"] == expl["severity"]
    assert result["evidence"] == expl["evidence"]
    assert result["anomalyScore"] == expl["model"]["anomaly_score"]
    assert expl["model"]["name"] == "Isolation Forest"
    return result, expl


def test_xai_leak_signals_dynamic():
    from app.simulator import BASE_FLOW, BASE_PRESSURE
    result, expl = _explanation_for("leak")
    last = result["latest"]
    flow_sig = next(s for s in expl["signals"] if s["feature"] == "flow")
    press_sig = next(s for s in expl["signals"] if s["feature"] == "pressure")
    # Values are computed from the actual telemetry point, not hardcoded.
    assert flow_sig["value"] == round(last["flow"], 1)
    assert flow_sig["baseline"] == BASE_FLOW
    assert flow_sig["change_percent"] == round((last["flow"] - BASE_FLOW) / BASE_FLOW * 100, 1)
    assert flow_sig["direction"] == "increase" and flow_sig["impact"] == "high"
    assert press_sig["direction"] == "decrease" and press_sig["impact"] == "high"
    assert press_sig["baseline"] == BASE_PRESSURE
    assert "leak" in expl["summary"].lower() and expl["severity"] == "HIGH"
    assert len(expl["diagnosis"]["alternatives"]) == 3


def test_xai_all_scenarios():
    expectations = {
        "leak": "Confirmed Leak",
        "burst": "Confirmed Burst",
        "demand": "Demand Spike",
        "sensor": "Sensor Fault",
    }
    for scenario, primary in expectations.items():
        result, expl = _explanation_for(scenario)
        assert expl["diagnosis"]["primary"] == primary, scenario
        assert expl["summary"] and expl["model"]["interpretation"]
        assert {s["feature"] for s in expl["signals"]} >= {"flow", "pressure", "consumption"}
        for s in expl["signals"]:
            assert set(s) == {"feature", "value", "baseline", "change_percent",
                              "direction", "impact", "reason"}
            assert s["direction"] in ("increase", "decrease", "stable")
    # Normal telemetry: explanation stays consistent with the (unchanged) detection
    # output and reports a calm severity — whatever the existing ranker decides.
    result, normal_expl = _explanation_for("normal")
    assert normal_expl["severity"] in ("NORMAL", "LOW")
    assert normal_expl["diagnosis"]["primary"] == result["primaryHypothesis"]
    # Unit-cover the Normal Operation summary branch of the builder directly.
    from app.ai import build_explanation
    calm = build_explanation(
        {"flow": 8000.0, "pressure": 4.0, "consumption": 3000.0, "level": 3.2},
        {"flow": 0.0, "pressure": 0.0, "consumption": 0.0, "level": 0.0},
        0.05,
        [{"cause": "Normal Operation", "score": 90.0},
         {"cause": "Valve Issue", "score": 6.0}],
        "NORMAL", ["Telemetry within expected range."])
    assert calm["summary"].startswith("Normal operating condition")
    assert calm["model"]["interpretation"] == "Within the normal operating range."
    assert all(s["direction"] == "stable" for s in calm["signals"])


def test_xai_detect_endpoint_carries_explanation():
    data = generate_telemetry("burst")
    r = client.post("/api/ai/detect", json={"telemetry": data})
    expl = r.json()["explanation"]
    assert expl["diagnosis"]["primary"] == "Confirmed Burst"
    assert expl["signals"][0]["value"] == round(data[-1]["flow"], 1)


def test_xai_edge_cases():
    from app.ai import analyze
    # Missing tank level: level signal omitted, never invented.
    no_level = generate_telemetry("leak")
    for p in no_level:
        del p["level"]
    expl = analyze(no_level)["explanation"]
    assert all(s["feature"] != "level" for s in expl["signals"])
    assert {s["feature"] for s in expl["signals"]} == {"flow", "pressure", "consumption"}
    # Null eddy + extreme values must not crash.
    extreme = generate_telemetry("normal")
    extreme[-1]["eddy_current_variance"] = None
    extreme[-1]["flow"] = 999999.0
    assert analyze(extreme)["explanation"]["signals"][0]["value"] == 999999.0
    # Missing / null / invalid required fields -> ValueError (API maps to 400).
    bad_window = generate_telemetry("normal")
    del bad_window[-1]["flow"]
    try:
        analyze(bad_window)
        raise AssertionError("expected ValueError for missing flow")
    except ValueError:
        pass
    bad_window = generate_telemetry("normal")
    bad_window[-1]["pressure"] = None
    try:
        analyze(bad_window)
        raise AssertionError("expected ValueError for null pressure")
    except ValueError:
        pass
    bad_window = generate_telemetry("normal")
    bad_window[-1]["consumption"] = "not-a-number"
    try:
        analyze(bad_window)
        raise AssertionError("expected ValueError for invalid consumption")
    except ValueError:
        pass
    # API surfaces malformed telemetry as a client error, not a 500.
    # (Pydantic rejects non-numeric strings with 422 before analyze() runs;
    #  analyze() itself raises ValueError -> 400 for missing/null numerics.)
    r = client.post("/api/ai/detect", json={"telemetry": generate_telemetry("normal")})
    assert r.status_code == 200 and "explanation" in r.json()
    broken = generate_telemetry("normal")
    broken[-1]["flow"] = "not-a-number"
    assert client.post("/api/ai/detect", json={"telemetry": broken}).status_code in (400, 422)


def test_real_data_metadata():
    r = client.get("/api/real-data/metadata")
    assert r.status_code == 200
    j = r.json()
    assert j["dataset"] == "BattLeDIM 2018 L-Town Benchmark"
    assert j["total_records"] == 105120
    assert "p227" in j["flow_sensors"]
    assert "p235" in j["flow_sensors"]
    assert "PUMP_1" in j["flow_sensors"]
    assert len(j["pressure_sensors"]) == 33
    assert j["leakage_events_count"] == 14
    assert j["timestamp_start"].startswith("2018-01-01")
    assert j["timestamp_end"].startswith("2018-12-31")


def test_real_data_leakages():
    r = client.get("/api/real-data/leakages")
    assert r.status_code == 200
    j = r.json()
    assert j["count"] == 14
    assert len(j["events"]) == 14
    pipes = [e["pipe"] for e in j["events"]]
    assert "p31" in pipes
    assert "p232" in pipes
    # Verify duration and rate are positive
    assert all(e["duration_hours"] > 0 and e["max_rate"] > 0 for e in j["events"])


def test_real_data_telemetry_window():
    r = client.get("/api/real-data/telemetry?points=16")
    assert r.status_code == 200
    j = r.json()
    assert j["mode"] == "real"
    assert len(j["telemetry"]) == 16
    first = j["telemetry"][0]
    # Check timestamp preservation
    assert "2018-" in first["time"]
    assert first["flow"] > 0
    assert first["pressure"] > 0
    assert "flows" in first and "p227" in first["flows"]


def test_real_data_event_focus():
    r = client.get("/api/real-data/telemetry?event_pipe=p31&points=12")
    assert r.status_code == 200
    j = r.json()
    assert j["active_event"] is not None
    assert j["active_event"]["pipe"] == "p31"
    assert len(j["telemetry"]) == 12


def _synthetic_5min(n, flow_fn, press_fn, start="2026-01-01 00:00:00"):
    import datetime
    t0 = datetime.datetime.strptime(start, "%Y-%m-%d %H:%M:%S")
    pts = []
    for i in range(n):
        t = (t0 + datetime.timedelta(minutes=5 * i)).strftime("%Y-%m-%d %H:%M:%S")
        pts.append({"time": t, "flow": flow_fn(i), "pressure": press_fn(i),
                    "consumption": 3000.0})
    return pts


def test_temporal_lags_exact():
    from temporal.feature_engine import lag_lookup, monotonic_minutes
    pts = _synthetic_5min(12, lambda i: 8000.0 + 100.0 * i, lambda i: 4.0)
    times = monotonic_minutes([p["time"] for p in pts])
    flows = [p["flow"] for p in pts]
    for lag, expected in ((5, 9000.0), (15, 8800.0), (30, 8500.0)):
        lk = lag_lookup(times, flows, 11, lag)
        assert lk["value"] == expected, (lag, lk)
        assert lk["actual_minutes"] == float(lag) and lk["truncated"] is False


def test_temporal_rolling_stats():
    from temporal.feature_engine import point_features, monotonic_minutes
    pts = _synthetic_5min(8, lambda i: 8000.0, lambda i: 4.0)
    times = monotonic_minutes([p["time"] for p in pts])
    series = {"flow": [p["flow"] for p in pts], "pressure": [p["pressure"] for p in pts]}
    f = point_features(times, series, 7)
    assert f["signals"]["flow"]["rolling"]["mean"] == 8000.0
    assert f["signals"]["flow"]["rolling"]["std"] == 0.0
    assert f["signals"]["flow"]["rolling"]["z"] == 0.0
    pts2 = _synthetic_5min(3, lambda i: [8000.0, 8100.0, 8200.0][i], lambda i: 4.0)
    t2 = monotonic_minutes([p["time"] for p in pts2])
    s2 = {"flow": [p["flow"] for p in pts2], "pressure": [p["pressure"] for p in pts2]}
    f2 = point_features(t2, s2, 2)
    assert f2["signals"]["flow"]["rolling"]["mean"] == 8100.0
    assert abs(f2["signals"]["flow"]["rolling"]["std"] - 81.6496) < 0.01


def test_temporal_trend():
    from temporal.feature_engine import point_features, monotonic_minutes
    pts = _synthetic_5min(7, lambda i: 8000.0 + 100.0 * i, lambda i: 4.0)
    times = monotonic_minutes([p["time"] for p in pts])
    series = {"flow": [p["flow"] for p in pts], "pressure": [p["pressure"] for p in pts]}
    f = point_features(times, series, 6)
    tr = f["signals"]["flow"]["trend"]
    assert tr["direction"] == "rising" and tr["slope_per_min"] > 0
    assert tr["change_pct_30m"] > 5.0


def test_temporal_persistence():
    from temporal.persistence import persistence_status
    times = [float(i * 5) for i in range(5)]
    p = persistence_status([False, False, True, True, True], times, 4)
    assert p["consecutive_points"] == 3 and p["duration_minutes"] == 10.0
    assert p["grade"] == "HIGH"
    q = persistence_status([False, False, False, True], times[:4], 3)
    assert q["grade"] == "LOW"  # lone spike is never HIGH persistence


def test_temporal_missing_data():
    from temporal import analyze_temporal
    pts = _synthetic_5min(8, lambda i: 8000.0, lambda i: 4.0)
    pts[3]["flow"] = None
    pts[5]["pressure"] = None
    r = analyze_temporal(pts, if_score=0.2)
    assert r["score"] is not None and "factors" in r and "why" in r


def test_temporal_no_future_leakage():
    from temporal.feature_engine import point_features, monotonic_minutes
    from temporal import analyze_temporal
    base = generate_telemetry("normal", points=8)
    t1 = monotonic_minutes([p["time"] for p in base])
    s1 = {"flow": [p["flow"] for p in base], "pressure": [p["pressure"] for p in base]}
    f_before = point_features(t1, s1, 4)
    extended = base + generate_telemetry("leak", points=4)
    r_before = analyze_temporal(base)["score"]
    t2 = monotonic_minutes([p["time"] for p in extended])
    s2 = {"flow": [p["flow"] for p in extended], "pressure": [p["pressure"] for p in extended]}
    f_after = point_features(t2, s2, 4)
    assert f_before == f_after  # future spike cannot rewrite past features
    assert analyze_temporal(base)["score"] == r_before


def test_temporal_fusion_detect_endpoint():
    data = generate_telemetry("leak")
    r = client.post("/api/ai/detect", json={"telemetry": data})
    j = r.json()
    t = j["temporal"]
    assert set(t["factors"]) == {"flow_deviation", "pressure_deviation", "trend",
                                 "persistence", "historical_context"}
    assert t["factors"]["flow_deviation"] == "HIGH"
    assert 0.0 <= t["score"] <= 1.0 and t["no_future_leakage"] is True
    assert any("Temporal pattern" in e for e in j["evidence"])
    # Existing behavior preserved.
    assert j["primaryHypothesis"] == "Confirmed Leak" and j["severity"] == "HIGH"
    r = client.post("/api/ai/detect", json={"telemetry": generate_telemetry("normal")})
    assert r.json()["severity"] in ("NORMAL", "LOW")


def test_temporal_real_shaped_window():
    # Full-timestamp 5-min SCADA-shaped window, model-free (no sim-trained model).
    from temporal import analyze_temporal
    pts = _synthetic_5min(24, lambda i: 180.0 + (60.0 if i >= 18 else 0.0),
                          lambda i: 42.0 - (6.0 if i >= 18 else 0.0))
    r = analyze_temporal(pts, if_score=None)
    assert r["score_components"]["model"] is None
    assert r["factors"]["flow_deviation"] in ("MEDIUM", "HIGH")
    assert r["persistence"]["grade"] in ("MEDIUM", "HIGH")


if __name__ == "__main__":
    import time
    tests = sorted({k: v for k, v in globals().items() if k.startswith("test_")}.items())
    print(f"Running {len(tests)} tests...", flush=True)
    for name, fn in tests:
        t_start = time.time()
        print(f"RUN  {name}...", end="", flush=True)
        fn()
        print(f" PASS ({time.time() - t_start:.2f}s)", flush=True)
    print("ALL TESTS PASSED!", flush=True)

