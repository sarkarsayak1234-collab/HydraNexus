# HydraNexus — AI-Powered Water Decision Intelligence
**Team:** Zero Commits · **Lead:** Ritoyash Pal · **Focus:** Open Innovation

Software-first platform: Detect → Investigate → Verify → Assess → Simulate → Decide.
Human-in-the-loop — evidence-backed recommendations, no autonomous control.

## Structure
- `hydranexus-frontend/` — React/Vite operator dashboard (React Flow network map, Recharts telemetry, What-If Studio). Offline-capable via mock `src/data.js`; uses live API when `VITE_API_URL` is reachable (`src/api.js`).
- `backend/` — FastAPI + Pandas/NumPy + Scikit-learn (IsolationForest) + NetworkX. Simulates telemetry, detects anomalies, ranks causes, localizes faults, verifies scenarios, simulates interventions.

## Quickstart
Backend:
```powershell
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
# docs: http://localhost:8000/docs
python test_api.py
```
Frontend:
```powershell
cd hydranexus-frontend
copy .env.example .env
npm install
npm run dev
```

## Live Deployment
- **Frontend (Vercel):** [https://hydra-nexus-21a4.vercel.app](https://hydra-nexus-21a4.vercel.app)
- **Backend (Render):** [https://hydranexus-api.onrender.com](https://hydranexus-api.onrender.com)

## PRD coverage
- 3.1 Simulated network: `backend/app/simulator.py` + `topology.py`, visualized in Network Map.
- 3.2 AI module: `backend/app/ai.py` (detection, ranking, localization, impact).
- 3.3 Decision support: `POST /api/verify`, `POST /api/whatif`, Investigation + What-If Studio UI.
- Scalability: Building → Campus → Industrial → Community → District → Municipal (topology is code-defined; swap in GIS/SCADA later).

