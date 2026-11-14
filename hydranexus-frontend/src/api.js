// HydraNexus backend client (software-first, offline-capable).
// Tries FastAPI at VITE_API_URL, falls back to mock src/data.js when unreachable.
// Keeps human-in-the-loop: all AI results are advisory with confidence + evidence.

// Resolve backend base URL. Priority:
// 1. VITE_API_URL (explicit, e.g. http://127.0.0.1:8000)
// 2. Same hostname as the page on port 8000 (avoids Windows localhost→::1
//    IPv6 mismatch when the backend is bound to 127.0.0.1)
// 3. http://localhost:8000 fallback
function resolveBase() {
  const fromEnv = import.meta?.env?.VITE_API_URL
  if (fromEnv) return fromEnv.replace(/\/$/, '')
  try {
    const host = window?.location?.hostname
    const proto = window?.location?.protocol
    // Production (Vercel https) -> Render backend. Avoids mixed-content
    // http://host:8000 which fails on https vercel.app.
    if (host && (host.includes('vercel.app') || host.includes('hydra-nexus'))) {
      return 'https://hydranexus-api.onrender.com'
    }
    if (host && proto === 'https:') {
      return 'https://hydranexus-api.onrender.com'
    }
    if (host) return `http://${host}:8000`
  } catch { /* non-browser (SSR/tests) -> fallback below */ }
  return 'http://localhost:8000'
}

const BASE = resolveBase()

async function fetchJson(path, options = {}, timeoutMs = 4000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${BASE}${path}`, { ...options, signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(t)
  }
}

export const apiBase = BASE

export async function checkHealth() {
  // Retry once: the backend's first request can be slow (model warmup).
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const j = await fetchJson('/api/health', {}, 8000)
      return { online: true, info: j }
    } catch {
      if (attempt === 1) return { online: false, info: null }
    }
  }
  return { online: false, info: null }
}

export async function fetchTelemetry(scenario = 'normal', points = 8) {
  const j = await fetchJson(`/api/telemetry?scenario=${encodeURIComponent(scenario)}&points=${points}`)
  return j.telemetry
}

export async function fetchGraph(incidentActive = false) {
  const j = await fetchJson(`/api/network/graph?incidentActive=${incidentActive}`)
  return j
}

export async function postDetect(telemetry) {
  // Retry once with longer timeout: Render free tier cold-starts can exceed 4s.
  let lastErr = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const j = await fetchJson(
        '/api/ai/detect',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ telemetry }),
        },
        10000
      )
      return j
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr ?? new Error('detect failed')
}

export async function fetchAlerts(scenario = 'leak', points = 8) {
  const j = await fetchJson(`/api/ai/alerts?scenario=${encodeURIComponent(scenario)}&points=${points}`)
  return j
}

export async function postVerify(observed, hypothesis = 'leak', segment = 'B2 → B3') {
  const j = await fetchJson('/api/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ observed, hypothesis, segment }),
  })
  return j
}

export async function fetchIncidents() {
  const j = await fetchJson('/api/incidents', {}, 8000)
  return j
}

export async function fetchImpact(scenario = 'leak', points = 8) {
  const j = await fetchJson(`/api/impact?scenario=${encodeURIComponent(scenario)}&points=${points}`)
  return j
}

export async function postWhatIf(scenario = 'isolate', valveThrottle = 50, incident = 'leak', baselineLoss = null) {
  const j = await fetchJson('/api/whatif', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenario, valveThrottle, incident, baselineLoss }),
  })
  return j
}

export async function postDecisionCompare({ incident = 'leak', severity = 'HIGH', segment = 'B2 → B3', baselineLoss = null, valveThrottle = 50, weights = null, costs = null } = {}) {
  const j = await fetchJson('/api/decision/compare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ incident, severity, segment, baselineLoss, valveThrottle, weights, costs }),
  }, 10000)
  return j
}

export async function fetchDecisionConfig() {
  const j = await fetchJson('/api/decision/config')
  return j
}

export async function fetchRealDataMetadata() {
  const j = await fetchJson('/api/real-data/metadata', {}, 8000)
  return j
}

export async function fetchRealDataLeakages() {
  const j = await fetchJson('/api/real-data/leakages', {}, 8000)
  return j
}

export async function fetchRealDataTelemetry({ start, end, points = 24, event_pipe } = {}) {
  const params = new URLSearchParams()
  if (start) params.append('start', start)
  if (end) params.append('end', end)
  if (points) params.append('points', String(points))
  if (event_pipe) params.append('event_pipe', event_pipe)
  const query = params.toString() ? `?${params.toString()}` : ''
  const j = await fetchJson(`/api/real-data/telemetry${query}`, {}, 10000)
  return j
}

// Ground-truth validation benchmark. A cold Render instance needs ~3 min
// (reference model build + full replay), so allow a long timeout.
export async function fetchRealDataEvaluate() {
  const j = await fetchJson('/api/real-data/evaluate', {}, 240000)
  return j
}

export async function fetchRealDataModelInfo() {
  const j = await fetchJson('/api/real-data/model/info', {}, 30000)
  return j
}

export async function postRealDataDetect(points) {
  const j = await fetchJson(
    '/api/real-data/detect',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(points) },
    30000,
  )
  return j
}

// R1 — root-cause investigation over a real-SCADA window (SCADA signals only)
export async function postRealDataInvestigate(points) {
  const j = await fetchJson(
    '/api/real-data/investigate',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(points) },
    60000,
  )
  return j
}

// R2 — decision-support impact estimate over a real-SCADA window
export async function postRealDataImpact(points) {
  const j = await fetchJson(
    '/api/real-data/impact',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(points) },
    60000,
  )
  return j
}

// R3a — response planner (isolate / throttle / monitor / dispatch) over a
// real-SCADA window. Honest decision support — not a hydraulic simulation.
// The backend slices the window itself and scores it with the benchmark's
// causal 14-day baseline (cold start builds the merged frame once).
export async function fetchRealDataRespond({ event_pipe, points = 48, start, end } = {}) {
  const params = new URLSearchParams()
  if (event_pipe) params.append('event_pipe', event_pipe)
  if (points) params.append('points', String(points))
  if (start) params.append('start', start)
  if (end) params.append('end', end)
  const q = params.toString() ? `?${params.toString()}` : ''
  const j = await fetchJson(`/api/real-data/respond${q}`, {}, 180000)
  return j
}

// R4 — one-shot Live Replay payload (accelerated-time episode player).
// Cold start builds the merged SCADA frame once (~105k rows), so allow a long timeout.
export async function fetchRealDataReplay(eventPipe, force = false) {
  const q = `?event_pipe=${encodeURIComponent(eventPipe)}${force ? '&force=true' : ''}`
  const j = await fetchJson(`/api/real-data/replay${q}`, {}, 180000)
  return j
}

// R5 — create an incident from a real-SCADA alarm (Supabase-backed).
export async function createIncident(item) {
  const j = await fetchJson(
    '/api/incidents',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item) },
    10000,
  )
  return j
}

// Option B — hydraulic digital twin (official BattLeDIM EPANET model via WNTR).
// Cold start imports wntr + simulates; allow a long timeout.
export async function fetchHydraulicState({ when, hours = 24 } = {}) {
  const params = new URLSearchParams()
  if (when) params.append('when', when)
  params.append('hours', String(hours))
  const j = await fetchJson(`/api/hydraulic/state?${params.toString()}`, {}, 180000)
  return j
}

// True hydraulic What-If: leak injected ON the pipe, intervention simulated.
export async function fetchHydraulicWhatif({ leak_pipe, leak_lph = 8000, action = 'isolate', throttle_target = 0.3, when, hours = 24 }) {
  const params = new URLSearchParams({ leak_pipe, leak_lph: String(leak_lph), action, throttle_target: String(throttle_target), hours: String(hours) })
  if (when) params.append('when', when)
  const j = await fetchJson(`/api/hydraulic/whatif?${params.toString()}`, {}, 240000)
  return j
}

// Option A — hybrid model-based localization: SCADA pressure residuals matched
// against simulated leak fingerprints from the digital twin. Cold run = one
// week-long baseline sim + one fingerprint sim per candidate (~30-120 s).
export async function fetchHydraulicLocalize({ event_pipe, start, end, std_leak_lph = 15000, n_candidates = 12, points = 48 } = {}) {
  const params = new URLSearchParams({ std_leak_lph: String(std_leak_lph), n_candidates: String(n_candidates), points: String(points) })
  if (event_pipe) params.append('event_pipe', event_pipe)
  if (start) params.append('start', start)
  if (end) params.append('end', end)
  const j = await fetchJson(`/api/hydraulic/localize?${params.toString()}`, {}, 300000)
  return j
}

