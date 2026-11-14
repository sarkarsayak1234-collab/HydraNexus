# HydraNexus — AI-Powered Water Decision Intelligence

**Team:** Zero Commits A — **Lead:** Ritoyash Pal A — **Focus:** Open Innovation

Software-first platform: Detect → Investigate → Verify → Assess → Simulate → Decide.
Human-in-the-loop — evidence-backed recommendations, no autonomous control.

[![Ground-truth benchmark](https://github.com/sarkarsayak1234-collab/HydraNexus/actions/workflows/benchmark.yml/badge.svg)](https://github.com/sarkarsayak1234-collab/HydraNexus/actions/workflows/benchmark.yml)
![Dataset](https://img.shields.io/badge/dataset-BattLeDIM%202018%20real%20SCADA-10b981)
![Detection](https://img.shields.io/badge/ground%20truth%20in%20detection-NEVER-10b981)

---

## What is real here (the honest answer)

| Layer | Data source | Where |
|---|---|---|
| **Telemetry (Real SCADA mode)** | BattLeDIM 2018 L-Town SCADA — 105,120 records at 5-min intervals: 2 district inflow meters, pump discharge, 33 pressure sensors | `backend/data/real/*.csv` |
| **Leak detector (Real SCADA mode)** | Trained on the dataset's own typical operating state (robust hour-of-day median/MAD baselines + IsolationForest). **Never reads the ground-truth leak file** | `backend/real_data/detector.py` |
| **Validation** | Replays the frozen detector over every leak episode derived from the published ground truth + leak-free controls. All metrics below come from this real run — nothing is hard-coded | `backend/real_data/evaluate.py` |
| **GIS map** | Real L-Town geometry parsed from the official BattLeDIM network file (785 nodes, 905 pipes, 42.6 km). Model coordinates — honestly labelled, not georeferenced to a fake city | `hydranexus-frontend/src/data/ltown_network.json` |
| Demo Sim mode | Synthetic simulator (clearly labelled "Demo") | `backend/app/simulator.py` |

The old version fabricated anomaly scores from the answer key (`0.88 if leak active`). That code is **deleted**;
scores now come exclusively from the real detector, and ground truth appears only as a labelled overlay and in the
validation report.

## Ground-truth benchmark (real run, frozen rule)

The detector is replayed over the 48 h window around every significant leak episode in the published BattLeDIM
answer key (causal baseline: 14 days of pre-window data only), plus 20 leak-free control windows for false-alarm
exposure. Thresholds were frozen a priori and are reported verbatim in `/api/real-data/model/info`.

| Metric | Value |
|---|---|
| Event episodes (ground truth) | 12 |
| **Detected** | **7 / 12** |
| **Recall** | **58.3 %** |
| **Precision** | **74.5 %** |
| **F1** | **65.4 %** |
| Median detection latency | 215 min (5-min SCADA resolution) |
| Max latency | 680 min |
| Control-window false-alarm rate | 20 % (4/20 windows), 3.1 % of alarm points |
| Chronic background leaks (p257, p427) | absorbed into the typical state by design, reported separately |

Pre-alarms before an episode's start are usually **true alarms for a different concurrent leak** (attribution
analysis in the report — e.g. p538's pre-window contains p628's 35 m³/h leak). Misses are documented in
`method_notes`: intermittent single-step firings during gradual ramps (p628, p31, p183) and small 5–7 m³/h
slow-growing partial-chronic leaks (p654, p810) — the weakest hydraulic signature in the benchmark.

Reproduce it:

```powershell
pip install -r backend/requirements.txt
python backend/test_benchmark_local.py   # prints the full metrics table
```

or hit the live endpoint: `GET https://hydranexus-api.onrender.com/api/real-data/evaluate`
(first run cold-starts the reference model server-side, ~30–60 s, then cached).

## Detection architecture (frozen, transparent)

1. **Reference state** — robust hour-of-day median/MAD baselines for total inflow, both district meters and every
   pressure sensor, + an IsolationForest trained on the typical operating state. Robust stats prevent concurrent
   leaks from masking each other; chronic background leaks are part of "normal".
2. **Alarm rule** — inflow elevated above its hour baseline (z ≥ 2.5, or a single meter ≥ 3.0) **AND** a pressure
   cluster sagging (strongest sensor ≤ −3.0 with ≥ 3 sensors ≤ −1.5), sustained 3 consecutive 5-min readings.
   The cluster rejects single-sensor glitches; persistence rejects single-point noise.
3. **Localization** — the sensor with the most negative hour-conditioned robust z-score.
4. **Impact** — unexplained inflow excess vs the hour baseline (L/h).

Detection never reads `2018_Leakages.csv`; evaluation and UI overlays do, and are labelled as such.

## API (real-data endpoints)

| Endpoint | Purpose |
|---|---|
| `GET /api/real-data/telemetry` | Windowed/downsampled real SCADA with real detector scores attached |
| `POST /api/real-data/detect` | Full Detect → Investigate → Assess pipeline over a real window (+ evidence-strength verification, per-step window detail) |
| `GET /api/real-data/evaluate` | The ground-truth benchmark report (metrics, per-episode detail, controls) |
| `GET /api/real-data/replay` | One-shot Live Replay payload: native 5-min window scored with the benchmark's causal baseline |
| `POST /api/real-data/investigate` | Root-cause view: sensor-z ranking, meter decomposition, hour context, supply-branch attribution |
| `POST /api/real-data/impact` | Impact estimate: excess-inflow loss rate/volume, affected branch, labelled answer-key overlay |
| `GET /api/real-data/respond` | Response planner: isolate / throttle / monitor / dispatch with SCADA-derived savings and stated assumptions (decision support — not a simulation) |
| `GET /api/hydraulic/state` | Hydraulic digital twin: flow in EVERY pipe + pressure at every node of the official BattLeDIM EPANET model (WNTR/EPANET) |
| `GET /api/hydraulic/whatif` | True hydraulic What-If: leak injected ON the pipe (EPANET split + midpoint emitter sized from SCADA), isolate/throttle actually simulated, three-simulation comparison |
| `GET /api/hydraulic/localize` | Hybrid localization: SCADA pressure residuals (week-calibrated, gravity signature) matched against simulated leak fingerprints on candidate pipes |
| `GET /api/real-data/model/info` | Detector model card: training data, frozen thresholds, provenance disclosure |
| `GET /api/real-data/metadata` · `/leakages` | Dataset metadata and labelled ground-truth episodes |

## Structure

- `hydranexus-frontend/` — React/Vite operator dashboard (React Flow network map, Recharts telemetry, real L-Town
  GIS map, What-If Studio, **Validation** page). Offline-capable via mock `src/data.js`; uses live API when
  `VITE_API_URL` is reachable (`src/api.js`).
- `backend/` — FastAPI + Pandas/NumPy + Scikit-learn (IsolationForest) + NetworkX.
- `backend/real_data/` — real-SCADA loader, mapper, **detector** (ground-truth-free), **evaluate** (honest
  benchmark), **investigate / impact / respond / replay** (real-mode decision layers), **network** (L-Town supply-branch
  graph), **hydraulic** (digital twin: the official BattLeDIM EPANET model simulated with WNTR — flow in every pipe,
  true isolate/throttle outcomes), processor, schema.
- `backend/data/real/` — BattLeDIM 2018 SCADA + ground truth CSVs + `L-TOWN_v2_Model.inp` (official KIOS EPANET model).

## Live Deployment

- **Frontend (Vercel):** [https://hydra-nexus-21a4.vercel.app](https://hydra-nexus-21a4.vercel.app)
- **Backend (Render):** [https://hydranexus-api.onrender.com](https://hydranexus-api.onrender.com)

## Quickstart

Backend:
```powershell
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
# docs: http://localhost:8000/docs
```

Frontend:
```powershell
cd hydranexus-frontend
copy .env.example .env
npm install
npm run dev
```

## Dataset & network provenance

- **Dataset:** BattLeDIM 2018 — Battle of the Leakage Detection and Isolation Methods, KIOS Research Center
  (Vrachimis et al., CCWI/WDSA 2020). SCADA + published ground truth: [Zenodo record 4017659](https://zenodo.org/records/4017659),
  code/competition: [KIOS-Research/BattLeDIM](https://github.com/KIOS-Research/BattLeDIM).
- **Network geometry:** official L-TOWN v1.2 network file from the same repository. The map renders the native
  model coordinates on a plain coordinate plane (no fake tile georeferencing).
- **Demo-mode assets** are labelled `Demo GIS` / `Demo` everywhere they appear.

## PRD coverage

- 3.1 Simulated network: `backend/app/simulator.py` + `topology.py`, visualized in Network Map.
- 3.2 AI module: `backend/app/ai.py` (detection, ranking, localization, impact).
- 3.3 Decision support: `POST /api/verify`, `POST /api/whatif`, Investigation + What-If Studio UI.
- 3.4 Real-data mode: BattLeDIM 2018 SCADA feeds, real detector, honest validation, real GIS.
- Scalability: Building → Campus → Industrial → Community → District → Municipal.
