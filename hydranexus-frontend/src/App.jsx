import { useMemo, useState, useEffect } from 'react'
import { CheckCircle2, AlertTriangle, Download, FileText, Play, X, Database } from 'lucide-react'
import Sidebar from './components/Sidebar'
import PageHeader from './components/PageHeader'
import NetworkMap from './components/NetworkMap'
import TelemetryCharts from './components/TelemetryCharts'
import RealTelemetryCharts from './components/RealTelemetryCharts'
import AmbientNetwork from './components/visual/AmbientNetwork'
import PageTransition from './components/visual/PageTransition'
import LandingExperience from './components/landing/LandingExperience'
import FaultLocationCard from './components/FaultLocationCard'
import FaultMapModal from './components/FaultMapModal'
import { getFaultLocation, getAssetGIS } from './gis'
import { Button } from './components/ui/button'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from './components/ui/card'
import { Badge } from './components/ui/badge'
import { Input } from './components/ui/input'
import { Separator } from './components/ui/separator'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from './components/ui/table'
import {
  zones,
  incidents,
  normalTelemetry,
  leakTelemetry,
  burstTelemetry,
  demandTelemetry,
  sensorTelemetry,
  corrosionTelemetry,
  whatIfOptions,
} from './data'
import {
  checkHealth,
  fetchTelemetry,
  postDetect,
  postVerify,
  postWhatIf,
  postDecisionCompare,
  fetchIncidents,
  fetchRealDataMetadata,
  fetchRealDataLeakages,
  fetchRealDataTelemetry,
} from './api'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

function VerifyChart({ observed, simulated }) {
  const rows = (observed || []).map((o, i) => ({
    time: o.time,
    observedFlow: o.flow,
    simulatedFlow: simulated?.[i]?.flow ?? null,
  }))
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
          <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="time" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={55} />
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line type="monotone" dataKey="observedFlow" name="Observed flow" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="simulatedFlow" name="Simulated hypothesis" stroke="#16a34a" strokeWidth={2} strokeDasharray="5 5" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

const pageMeta = {
  overview: ['Overview', 'Network health and active incidents.'],
  network: ['Network', 'Topology, zones and the suspected fault location.'],
  monitoring: ['Telemetry', 'Flow, pressure, consumption and tank level. Simulated feed.'],
  incident: ['Investigation', 'Evidence behind the current hypothesis.'],
  impact: ['Impact', 'Estimated loss, exposure and severity.'],
  whatif: ['What-If', 'Compare interventions before acting.'],
  history: ['History', 'Active and resolved events.'],
  settings: ['Settings', 'Prototype controls and data environment.'],
  privacy: ['Privacy Policy', 'How demo data and incident records are handled.'],
  terms: ['Terms and Conditions', 'Rules for using this demonstration interface.'],
}

const fmt = (value) => Number(value).toLocaleString()

function PageSection({ eyebrow, title, description, action, children }) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          {eyebrow && <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{eyebrow}</p>}
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function Stat({ label, value, hint, alert = false }) {
  return (
    <Card className="border-slate-800/80 bg-[#0c1626]/80 backdrop-blur-sm shadow-md shadow-black/20 hover:border-slate-700/80 transition-all duration-200">
      <CardContent className="pt-5">
        <p className="text-[11px] font-mono uppercase tracking-wider text-slate-400">{label}</p>
        <p className={`mt-1 text-2xl font-semibold tracking-tight font-mono ${alert ? 'text-red-400' : 'text-slate-100'}`}>{value}</p>
        {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
      </CardContent>
    </Card>
  )
}

function Toast({ toast, onClose }) {
  if (!toast) return null
  return (
    <div className="fixed right-4 top-4 z-50 flex max-w-sm items-start gap-2.5 rounded-lg border border-slate-700 bg-[#0c1626]/95 backdrop-blur-md p-3.5 shadow-2xl text-slate-100 animate-in fade-in slide-in-from-top-3 duration-200">
      {toast.type === 'danger' ? (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
      ) : (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
      )}
      <p className="text-xs leading-relaxed text-slate-200">{toast.message}</p>
      <button onClick={onClose} className="rounded p-0.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors" aria-label="Dismiss">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

/* ------------------------------- Overview ------------------------------- */

function Overview({ active, data, scenario = 'leak', setPage, trigger, onExport, onOpenRealData, onViewMap }) {
  const last = data?.at(-1)
  const profile = SCENARIO_PROFILES[scenario] || SCENARIO_PROFILES.leak
  const [ai, setAi] = useState(null)
  useEffect(() => {
    let cancelled = false
    if (!active || !last) {
      setAi(null)
      return
    }
    postDetect(data)
      .then((res) => {
        if (!cancelled) setAi(res)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [active, scenario, data])
  const flow = last?.flow ?? (active ? (scenario === 'burst' ? 15300 : 11500) : 8180)
  const pressure = last?.pressure ?? (active ? (scenario === 'burst' ? 2.3 : 3.3) : 4.0)
  const loss = ai?.impact?.lossPerHour ?? (active ? profile.lossPerHour : 0)
  const hypothesis = ai?.primaryHypothesis ?? profile.primary ?? profile.title
  const segment = ai?.location?.segment ?? profile.location
  const zone = ai?.location?.zone ? `Zone ${ai.location.zone}` : profile.zone
  const confidence = ai?.confidence ?? profile.confidence
  const severity = ai?.severity ?? profile.severity
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Status" value={active ? 'Investigating' : 'Normal'} hint={active ? `1 ${severity.toLowerCase()}-severity incident (${scenario})` : 'Within baseline'} alert={active} />
        <Stat label="Flow" value={`${fmt(Math.round(flow))} L/hr`} hint="Baseline ≈ 8,000 L/hr" alert={flow > 9000} />
        <Stat label="Avg. pressure" value={`${Number(pressure).toFixed(1)} bar`} hint="Baseline ≈ 4.0 bar" alert={pressure < 3.6} />
        <Stat label="Est. loss" value={`${fmt(Math.round(loss))} L/hr`} hint={active ? `Potential ${hypothesis.toLowerCase()}` : 'No active loss'} alert={active && loss > 500} />
      </div>

      {/* Real SCADA Dataset Quick Access Banner */}
      <div className="rounded-xl border border-emerald-500/30 bg-gradient-to-r from-emerald-950/40 via-[#0c1626]/90 to-[#0c1626] p-4 shadow-lg backdrop-blur-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-400">
              <Database className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-white tracking-wide">Real SCADA Dataset Mode</span>
                <span className="rounded-full bg-emerald-500/20 border border-emerald-500/40 px-2 py-0.5 text-[10px] font-mono font-semibold text-emerald-300">
                  BattLeDIM 2018 Benchmark
                </span>
              </div>
              <p className="mt-0.5 text-xs text-slate-300">
                Explore real historical SCADA telemetry across 2,176 km of physical water network, 442 sensors, and ground-truth leak events.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              size="sm"
              onClick={onOpenRealData}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-xs shadow-md shadow-emerald-900/40 cursor-pointer"
            >
              Open Real SCADA Mode →
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-sm font-medium">Network</CardTitle>
              <CardDescription>Simulated topology</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => setPage('network')}>
              Open map
            </Button>
          </CardHeader>
          <CardContent>
            <NetworkMap incidentActive={active} compact scenario={scenario} onSelectSegment={() => setPage('network')} onViewMap={onViewMap} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">{active ? 'Active incident' : 'No active incident'}</CardTitle>
            <CardDescription>{active ? `${segment} · ${zone} · ${scenario}` : 'System nominal'}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {active ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-sm">{hypothesis}</span>
                  <Badge variant={severity === 'HIGH' ? 'destructive' : 'outline'}>{severity}</Badge>
                </div>
                <Separator />
                <dl className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Confidence</dt>
                    <dd className="font-medium">{confidence}%</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Est. loss</dt>
                    <dd className="font-medium">{fmt(Math.round(loss))} L/hr</dd>
                  </div>
                  <div className="flex justify-between items-center">
                    <dt className="text-muted-foreground">Coordinates</dt>
                    <dd className="font-medium font-mono text-xs text-cyan-400 flex items-center gap-1">
                      <span>{ai?.location?.latitude ? `${Number(ai.location.latitude).toFixed(4)}°, ${Number(ai.location.longitude).toFixed(4)}°` : '22.5726°, 88.3639°'}</span>
                      {onViewMap && (
                        <button
                          onClick={() => onViewMap(ai?.location || getFaultLocation(segment))}
                          className="hover:underline text-cyan-300 ml-1 cursor-pointer font-sans text-xs"
                          title="View on Map"
                        >
                          [Map]
                        </button>
                      )}
                    </dd>
                  </div>
                </dl>
                <div className="flex gap-2 pt-1">
                  <Button size="sm" onClick={() => setPage('incident')}>
                    Investigate
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setPage('whatif')}>
                    What-if
                  </Button>
                </div>
                <Button size="sm" variant="ghost" onClick={onExport}>
                  <Download /> Export report
                </Button>
              </>
            ) : (
              <div className="flex flex-col items-center py-6 text-center">
                <CheckCircle2 className="h-8 w-8 text-emerald-600" />
                <p className="mt-2 text-sm font-medium">Network looks healthy</p>
                <p className="mt-1 text-xs text-muted-foreground">Inject a controlled incident to test the workflow.</p>
                <Button size="sm" className="mt-3" onClick={trigger}>
                  <Play /> Trigger simulated leak
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <PageSection eyebrow="Telemetry" title="Network pulse" description="Simulated feed with anomaly scoring.">
        <TelemetryCharts data={data} />
      </PageSection>

      <PageSection eyebrow="Zones" title="Zone health">
        <div className="grid gap-3 md:grid-cols-3">
          {zones.map((zone) => {
            const critical = active && ai ? zone.id === ai.location?.zone : active && zone.id === 'B'
            return (
              <Card key={zone.id}>
                <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">{zone.name}</CardTitle>
                  {critical ? <Badge variant="destructive">Critical</Badge> : <Badge variant="secondary">Normal</Badge>}
                </CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">Demand</dt>
                      <dd className="font-medium">{fmt(zone.demand)} L/hr</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Pressure</dt>
                      <dd className="font-medium">{(critical && pressure ? Number(pressure).toFixed(1) : zone.pressure.toFixed(1))} bar</dd>
                    </div>
                  </dl>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {fmt(zone.users)} users · Baseline loss {zone.baselineLoss}
                  </p>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </PageSection>
    </div>
  )
}

/* -------------------------------- Network ------------------------------- */

function NetworkPage({ active, scenario = 'leak', onViewMap }) {
  const suspectedSegment = scenario === 'demand' ? 'N1 → Zone C' : scenario === 'sensor' ? 'N1 → B2' : 'B2 → B3'
  const faultLoc = getFaultLocation(suspectedSegment)

  return (
    <div className="space-y-4">
      <PageSection
        eyebrow="Topology"
        title="Distribution map"
        description="Prototype network. Highlight follows the AI localization."
        action={active && <Badge variant="destructive">Suspected: {suspectedSegment}</Badge>}
      >
        <NetworkMap incidentActive={active} scenario={scenario} onViewMap={onViewMap} />
      </PageSection>
      <div className="grid gap-4 lg:grid-cols-3">
        <FaultLocationCard
          location={faultLoc}
          active={active}
          onViewMap={onViewMap}
          title={active ? 'Suspected Fault Location' : 'Asset Location'}
        />
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Components</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            {['Reservoir · Source', 'N1 · Main junction', 'N2 · Zone A', 'N3 · B2 junction', 'N4 · B3 / Zone B', 'N5 · Zone C', 'T1 · Tank Zone B', 'T2 · Tank Zone C'].map(
              (item) => (
                <div key={item} className="flex items-center justify-between border-b py-1.5 last:border-0">
                  <span>{item}</span>
                  <Badge variant="secondary">Online</Badge>
                </div>
              )
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Localization</CardTitle>
            <CardDescription>How the suspected segment is chosen</CardDescription>
          </CardHeader>
          <CardContent className="text-sm leading-6 text-muted-foreground">
            Abnormal telemetry is combined with the NetworkX topology to rank the most plausible segment. GIS
            coordinates locate the affected physical node for field response.
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

/* ------------------------------- Monitoring ------------------------------ */

const SCENARIOS = [
  ['normal', 'Normal'],
  ['leak', 'Leak'],
  ['burst', 'Burst'],
  ['demand', 'Demand spike'],
  ['sensor', 'Sensor fault'],
  ['corrosion', 'Corrosion / decay'],
]

function MonitoringPage({ scenario, setScenario, mode: propMode, setMode: propSetMode }) {
  const [internalMode, setInternalMode] = useState(propMode || 'demo')
  const mode = propMode !== undefined ? propMode : internalMode
  const setMode = propSetMode || setInternalMode
  const [search, setSearch] = useState('')
  const [live, setLive] = useState(null)
  const mocks = { normal: normalTelemetry, leak: leakTelemetry, burst: burstTelemetry, demand: demandTelemetry, sensor: sensorTelemetry, corrosion: corrosionTelemetry }

  // Real Data Mode State
  const [realMeta, setRealMeta] = useState(null)
  const [realLeakEvents, setRealLeakEvents] = useState([])
  const [selectedEventPipe, setSelectedEventPipe] = useState('p232')
  const [realPoints, setRealPoints] = useState(24)
  const [realResp, setRealResp] = useState(null)
  const [loadingReal, setLoadingReal] = useState(false)

  // Demo telemetry effect
  useEffect(() => {
    if (mode !== 'demo') return
    let cancelled = false
    setLive(null)
    fetchTelemetry(scenario, 8)
      .then((d) => {
        if (!cancelled) setLive(d)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [scenario, mode])

  // Real data metadata & events
  useEffect(() => {
    if (mode === 'real' && !realMeta) {
      fetchRealDataMetadata()
        .then((m) => {
          setRealMeta(m)
          if (m?.leakage_events?.length) {
            setRealLeakEvents(m.leakage_events)
          }
        })
        .catch(() => {})
    }
  }, [mode, realMeta])

  // Real telemetry fetching
  useEffect(() => {
    if (mode !== 'real') return
    let cancelled = false
    setLoadingReal(true)
    fetchRealDataTelemetry({
      event_pipe: selectedEventPipe || undefined,
      points: realPoints,
    })
      .then((res) => {
        if (!cancelled) {
          setRealResp(res)
          setLoadingReal(false)
        }
      })
      .catch(() => {
        if (!cancelled) setLoadingReal(false)
      })
    return () => {
      cancelled = true
    }
  }, [mode, selectedEventPipe, realPoints])

  const demoData = live || mocks[scenario]
  const demoLast = demoData.at(-1)
  const demoFiltered = search ? demoData.filter((d) => d.time.includes(search) || String(d.flow).includes(search)) : demoData

  const realData = realResp?.telemetry || []
  const realLast = realData.length ? realData.at(-1) : null
  const realFiltered = search && realData.length
    ? realData.filter((d) => d.time.includes(search) || String(d.flow).includes(search) || (d.active_leaks && d.active_leaks.some((l) => l.includes(search))))
    : realData

  return (
    <div className="space-y-4">
      {/* Mode Switcher Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
        <div className="inline-flex rounded-lg border border-slate-800 bg-[#0c1626]/90 p-1 text-xs backdrop-blur-sm shadow-inner">
          <button
            type="button"
            onClick={() => setMode('demo')}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-all ${
              mode === 'demo'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${mode === 'demo' ? 'bg-cyan-400' : 'bg-slate-500'}`} />
            Demo Simulation
          </button>
          <button
            type="button"
            onClick={() => setMode('real')}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-all ${
              mode === 'real'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${mode === 'real' ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
            Real SCADA Dataset (BattLeDIM 2018)
          </button>
        </div>

        {mode === 'real' && (
          <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
            <span className="rounded bg-emerald-950/60 px-2 py-0.5 border border-emerald-500/30 text-emerald-400 font-semibold">
              105,120 Records (5-min intervals)
            </span>
            <span className="hidden sm:inline text-slate-600">•</span>
            <span className="hidden sm:inline text-slate-400">3 Inflow Meters · 33 Pressure Sensors</span>
          </div>
        )}
      </div>

      {mode === 'demo' ? (
        <PageSection
          eyebrow="Telemetry"
          title="Monitoring"
          description={live ? 'Live backend feed.' : 'Backend unreachable — showing cached mock.'}
          action={
            <select
              value={scenario}
              onChange={(e) => setScenario(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              {SCENARIOS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          }
        >
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
            <Stat label="Flow" value={`${fmt(demoLast.flow)} L/hr`} hint="Expected ≈ 8,000" alert={demoLast.flow > 9000} />
            <Stat label="Pressure" value={`${demoLast.pressure.toFixed(1)} bar`} hint="Expected ≈ 4.0" alert={demoLast.pressure < 3.6} />
            <Stat label="Consumption" value={`${fmt(demoLast.consumption)} L/hr`} hint="Expected ≈ 3,000" alert={demoLast.consumption > 3600} />
            <Stat label="Tank level" value={`${(demoLast.level ?? 3.2).toFixed(2)} m`} hint="Expected ≈ 3.20" alert={(demoLast.level ?? 3.2) < 2.8} />
            <Stat label="Eddy variance" value={`${(demoLast.eddy_current_variance ?? 0).toFixed(2)}`} hint="0 healthy · 1 crack" alert={(demoLast.eddy_current_variance ?? 0) >= 0.5} />
          </div>
          <TelemetryCharts data={demoData} />
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm font-medium">Readings</CardTitle>
              <Input placeholder="Filter by time…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-[180px]" />
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Flow</TableHead>
                    <TableHead>Pressure</TableHead>
                    <TableHead>Consumption</TableHead>
                    <TableHead>Level</TableHead>
                    <TableHead>Eddy</TableHead>
                    <TableHead>Anomaly</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {demoFiltered
                    .slice()
                    .reverse()
                    .map((row) => {
                      const abnormal = row.flow > 9000 || row.pressure < 3.6 || row.consumption > 3600 || (row.level ?? 3.2) < 2.8 || (row.eddy_current_variance ?? 0) >= 0.5
                      return (
                        <TableRow key={row.time}>
                          <TableCell className="font-medium">{row.time}</TableCell>
                          <TableCell>{fmt(row.flow)}</TableCell>
                          <TableCell>{row.pressure.toFixed(1)}</TableCell>
                          <TableCell>{fmt(row.consumption)}</TableCell>
                          <TableCell>{(row.level ?? 3.2).toFixed(2)}</TableCell>
                          <TableCell>{(row.eddy_current_variance ?? 0).toFixed(2)}</TableCell>
                          <TableCell>{row.anomalyScore?.toFixed(2)}</TableCell>
                          <TableCell>
                            {abnormal ? <Badge variant="destructive">Anomaly</Badge> : <Badge variant="secondary">Normal</Badge>}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </PageSection>
      ) : (
        /* Real Data Mode View */
        <PageSection
          eyebrow="BattLeDIM 2018 SCADA"
          title="Real Infrastructure Telemetry"
          description={
            realResp?.active_event
              ? `Centred on Pipe ${realResp.active_event.pipe} leak episode (${realResp.active_event.start_time.slice(0, 10)} to ${realResp.active_event.end_time.slice(0, 10)} · peak rate ${realResp.active_event.max_rate} m³/h).`
              : 'Continuous 5-minute SCADA measurements across L-Town distribution grid.'
          }
          action={
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={selectedEventPipe}
                onChange={(e) => setSelectedEventPipe(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-2 text-xs font-mono"
              >
                <option value="">Baseline (No Active Leaks)</option>
                {realLeakEvents.map((ev) => (
                  <option key={ev.pipe} value={ev.pipe}>
                    Pipe {ev.pipe} ({ev.start_time.slice(0, 10)} · {ev.max_rate} m³/h · {ev.duration_hours}h)
                  </option>
                ))}
              </select>

              <select
                value={realPoints}
                onChange={(e) => setRealPoints(Number(e.target.value))}
                className="h-9 rounded-md border border-input bg-background px-2 text-xs font-mono"
              >
                <option value={16}>16 pts</option>
                <option value={24}>24 pts</option>
                <option value={48}>48 pts</option>
                <option value={96}>96 pts</option>
              </select>
            </div>
          }
        >
          {realLast ? (
            <>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                <Stat
                  label="Total Inflow"
                  value={`${realLast.flow.toFixed(1)} m³/h`}
                  hint={`p227: ${(realLast.flows?.p227 ?? 0).toFixed(1)} · p235: ${(realLast.flows?.p235 ?? 0).toFixed(1)}`}
                />
                <Stat
                  label="Pressure Head"
                  value={`${realLast.pressure.toFixed(1)} m`}
                  hint="33-Sensor Network Avg"
                  alert={realLast.pressure < 25.0}
                />
                <Stat
                  label="PUMP_1 Discharge"
                  value={`${(realLast.pump_flow || realLast.flows?.PUMP_1 || 0).toFixed(1)} m³/h`}
                  hint="L-Town Primary Station"
                />
                <Stat
                  label="Ground-Truth Leak"
                  value={`${(realLast.leak_rate ?? 0).toFixed(2)} m³/h`}
                  hint={realLast.active_leaks?.length ? `Pipe ${realLast.active_leaks.join(', ')} active` : 'No physical leakage'}
                  alert={(realLast.leak_rate ?? 0) > 0}
                />
                <Stat
                  label="Active Incident"
                  value={realLast.active_leaks?.length ? `Leak: ${realLast.active_leaks[0]}` : 'Grid Nominal'}
                  hint={realResp?.downsampled ? 'Downsampled from full window' : 'Exact 5-min intervals'}
                  alert={realLast.active_leaks?.length > 0}
                />
              </div>

              <RealTelemetryCharts data={realData} />

              <Card>
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <div>
                    <CardTitle className="text-sm font-medium">Real SCADA Feed Readings</CardTitle>
                    <CardDescription className="text-xs font-mono text-slate-400 mt-1">
                      Showing {realData.length} records · {realResp?.start} to {realResp?.end}
                    </CardDescription>
                  </div>
                  <Input
                    placeholder="Filter by time, flow…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="max-w-[180px] text-xs font-mono"
                  />
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Timestamp (UTC)</TableHead>
                        <TableHead>Inflow (m³/h)</TableHead>
                        <TableHead>Avg Head (m)</TableHead>
                        <TableHead>p227 Flow</TableHead>
                        <TableHead>p235 Flow</TableHead>
                        <TableHead>PUMP_1</TableHead>
                        <TableHead>Ground Truth Leak</TableHead>
                        <TableHead>Pipe</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {realFiltered
                        .slice()
                        .reverse()
                        .map((row) => {
                          const hasLeak = (row.leak_rate ?? 0) > 0 || (row.active_leaks && row.active_leaks.length > 0)
                          return (
                            <TableRow key={row.time}>
                              <TableCell className="font-mono text-xs font-medium">{row.time}</TableCell>
                              <TableCell className="font-mono text-xs">{row.flow.toFixed(1)}</TableCell>
                              <TableCell className="font-mono text-xs">{row.pressure.toFixed(1)}</TableCell>
                              <TableCell className="font-mono text-xs">{(row.flows?.p227 ?? 0).toFixed(1)}</TableCell>
                              <TableCell className="font-mono text-xs">{(row.flows?.p235 ?? 0).toFixed(1)}</TableCell>
                              <TableCell className="font-mono text-xs">{(row.pump_flow || row.flows?.PUMP_1 || 0).toFixed(1)}</TableCell>
                              <TableCell className="font-mono text-xs font-semibold text-rose-400">
                                {hasLeak ? `${(row.leak_rate ?? 0).toFixed(2)} m³/h` : '0.00'}
                              </TableCell>
                              <TableCell className="font-mono text-xs">
                                {row.active_leaks?.length ? (
                                  <span className="font-semibold text-rose-400">{row.active_leaks.join(', ')}</span>
                                ) : (
                                  <span className="text-slate-500">—</span>
                                )}
                              </TableCell>
                              <TableCell>
                                {hasLeak ? (
                                  <Badge variant="destructive" className="text-[10px] uppercase tracking-wider">Leak Active</Badge>
                                ) : (
                                  <Badge variant="secondary" className="text-[10px] text-emerald-400 border-emerald-500/30 bg-emerald-950/40">Grid Nominal</Badge>
                                )}
                              </TableCell>
                            </TableRow>
                          )
                        })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          ) : (
            <div className="p-8 text-center text-slate-400 font-mono text-sm border border-slate-800 rounded-lg bg-slate-900/40">
              {loadingReal ? 'Loading real SCADA telemetry from backend...' : 'No telemetry data available for this range.'}
            </div>
          )}
        </PageSection>
      )}
    </div>
  )
}

/* --------------------- AI Evidence & Diagnosis --------------------- */

const XAI_BASELINES = { flow: 8000, pressure: 4.0, consumption: 3000, level: 3.2 }
const XAI_UNITS = { flow: 'L/hr', pressure: 'bar', consumption: 'L/hr', level: 'm' }
const XAI_LABELS = { flow: 'Flow', pressure: 'Pressure', consumption: 'Consumption', level: 'Tank Level' }

export const SCENARIO_PROFILES = {
  leak: {
    title: 'Probable pipeline leak',
    primary: 'Confirmed Leak',
    severity: 'HIGH',
    confidence: 76,
    location: 'B2 → B3',
    zone: 'Zone B',
    lossPerHour: 3500,
    loss24h: 84000,
    flowChange: 43.8,
    pressureChange: -17.5,
    causes: [
      ['Confirmed Leak', 76],
      ['Pipeline Leak', 14],
      ['Demand Spike', 6],
      ['Valve Issue', 4],
    ],
    evidence: [
      'Flow increased by +43.8% at main arterial inlet B2',
      'Pressure dropped by -17.5% across downstream sensor B3',
      'End-user metered consumption remained stable (no demand spike pattern)',
      'Eddy-current sensor detected structural crack (variance 0.85) — wall breached',
    ],
  },
  burst: {
    title: 'Probable pipe burst',
    primary: 'Confirmed Burst',
    severity: 'HIGH',
    confidence: 86,
    location: 'B2 → B3',
    zone: 'Zone B',
    lossPerHour: 7000,
    loss24h: 168000,
    flowChange: 91.2,
    pressureChange: -42.5,
    causes: [
      ['Confirmed Burst', 86],
      ['Pipeline Leak', 14],
      ['Demand Spike', 0],
      ['Sensor Fault', 0],
    ],
    evidence: [
      'Catastrophic flow surge (+91.2%) at main arterial inlet B2',
      'Severe pressure collapse (-42.5%) across downstream sensor B3',
      'Storage tank level dropped rapidly to 1.95 m (rapid reservoir depletion)',
      'Eddy-current sensor confirmed critical pipe rupture (variance 0.92)',
    ],
  },
  demand: {
    title: 'Possible demand spike',
    primary: 'Demand Spike',
    severity: 'MEDIUM',
    confidence: 83,
    location: 'N1 → Zone C',
    zone: 'Zone C',
    lossPerHour: 0,
    loss24h: 0,
    flowChange: 35.4,
    pressureChange: -10.0,
    causes: [
      ['Demand Spike', 83],
      ['Valve Issue', 8],
      ['Pipeline Leak', 6],
      ['Sensor Fault', 3],
    ],
    evidence: [
      'Metered consumer draw jumped +46.7% across Zone C sub-district',
      'Pressure reduced modestly (-10.0%) during peak consumption draw',
      'Structural wall intact (eddy-current variance 0.02) — breach ruled out',
    ],
  },
  sensor: {
    title: 'Suspected sensor fault',
    primary: 'Sensor Fault',
    severity: 'LOW',
    confidence: 80,
    location: 'N1 → B2',
    zone: 'Zone B',
    lossPerHour: 0,
    loss24h: 0,
    flowChange: 2.2,
    pressureChange: -22.5,
    causes: [
      ['Sensor Fault', 80],
      ['Valve Issue', 12],
      ['Demand Spike', 5],
      ['Pipeline Leak', 3],
    ],
    evidence: [
      'Pressure transmitter reported sharp drop without corresponding flow increase',
      'Storage tank level held steady at 3.10 m (rules out actual physical water loss)',
      'Structural wall intact (eddy variance 0.02) — sensor recalibration required',
    ],
  },
  corrosion: {
    title: 'Early pipe corrosion watch',
    primary: 'Early Corrosion',
    severity: 'MEDIUM',
    confidence: 75,
    location: 'B2 → B3',
    zone: 'Zone B',
    lossPerHour: 0,
    loss24h: 0,
    flowChange: 2.2,
    pressureChange: 0.0,
    causes: [
      ['Early Corrosion', 75],
      ['Valve Issue', 10],
      ['Pipeline Leak', 8],
      ['Sensor Fault', 7],
    ],
    evidence: [
      'Hydraulic readings normal (flow 8,180 L/hr, pressure 4.0 bar)',
      'Eddy-current variance creeping upward to 0.44 (trend +0.22)',
      'Early wall degradation without a breach — schedule maintenance before failure',
    ],
  },
  normal: {
    title: 'Normal operation',
    primary: 'Normal Operation',
    severity: 'NORMAL',
    confidence: 98,
    location: 'All segments',
    zone: 'All zones',
    lossPerHour: 0,
    loss24h: 0,
    flowChange: 0.0,
    pressureChange: 0.0,
    causes: [
      ['Normal Operation', 98],
      ['Valve Issue', 2],
    ],
    evidence: ['All network telemetry operating within expected baseline envelopes.'],
  },
}

function xaiInterpretation(score) {
  if (score >= 0.9) return 'Highly abnormal operating condition.'
  if (score >= 0.7) return 'Strongly abnormal operating condition.'
  if (score >= 0.5) return 'Moderately abnormal operating condition.'
  if (score >= 0.3) return 'Mildly unusual operating condition.'
  return 'Within the normal operating range.'
}

function buildSignals(last, dev = null) {
  const bands = { flow: [25, 12], pressure: [15, 8], consumption: [25, 12], level: [10, 5] }
  return ['flow', 'pressure', 'consumption', 'level']
    .map((feature) => {
      const raw = last?.[feature]
      if (raw == null || !Number.isFinite(Number(raw))) return null
      const base = XAI_BASELINES[feature]
      const change = dev?.[feature] != null
        ? Number(dev[feature])
        : Math.round(((Number(raw) - base) / base) * 1000) / 10
      const direction = change >= 2 ? 'increase' : change <= -2 ? 'decrease' : 'stable'
      const mag = Math.abs(change)
      const impact = mag >= bands[feature][0] ? 'high' : mag >= bands[feature][1] ? 'medium' : 'low'
      const word = impact === 'high' ? 'significantly' : impact === 'medium' ? 'moderately' : 'slightly'
      const reason =
        direction === 'stable'
          ? `${XAI_LABELS[feature]} remains close to the normal baseline.`
          : `${XAI_LABELS[feature]} ${direction === 'increase' ? 'rose' : 'fell'} ${word} vs baseline.`
      return { feature, value: Number(raw), baseline: base, change_percent: change, direction, impact, reason }
    })
    .filter(Boolean)
}

function mockExplanation(last, profile) {
  const signals = buildSignals(last)
  const score = Number(last?.anomalyScore ?? 0)
  return {
    summary: profile.title ?? 'Incident',
    confidence: profile.confidence ?? 0,
    severity: profile.severity ?? 'Unknown',
    signals,
    evidence: profile.evidence ?? [],
    model: { name: 'Isolation Forest', anomaly_score: score, interpretation: xaiInterpretation(score) },
    diagnosis: {
      primary: profile.primary ?? profile.title,
      confidence: profile.confidence ?? 0,
      alternatives: (profile.causes ?? []).slice(1, 4).map(([cause, confidence]) => ({ cause, confidence })),
    },
  }
}

function synthesizeExplanationFromAi(ai, last, profile) {
  const signals = buildSignals(last, ai.deviation_pct)
  const primary = ai.primaryHypothesis || profile?.primary || 'Unknown'
  const confidence = ai.confidence ?? profile?.confidence ?? 0
  const severity = ai.severity ?? profile?.severity ?? 'HIGH'
  const score = ai.anomalyScore != null ? Number(ai.anomalyScore) : Number(last?.anomalyScore ?? 0)

  const noun = primary.toLowerCase()
  const summary =
    confidence >= 80
      ? `High probability of ${noun}`
      : confidence >= 60
        ? `Probable ${noun}`
        : `Possible ${noun}`

  const alternatives = (ai.causes ?? profile?.causes ?? []).slice(1, 4).map((c) => {
    if (Array.isArray(c)) return { cause: c[0], confidence: c[1] }
    return { cause: c.cause, confidence: c.score }
  })

  return {
    summary,
    confidence,
    severity,
    signals,
    evidence: ai.evidence && ai.evidence.length ? ai.evidence : profile?.evidence ?? [],
    model: { name: 'Isolation Forest', anomaly_score: score, interpretation: xaiInterpretation(score) },
    diagnosis: {
      primary,
      confidence,
      alternatives,
    },
  }
}

function SignalValue({ signal }) {
  const v = signal.value
  const text =
    signal.feature === 'pressure' || signal.feature === 'level'
      ? Number(v).toFixed(2)
      : fmt(Math.round(Number(v) * 10) / 10)
  return (
    <span className="font-medium">
      {text} <span className="font-normal text-muted-foreground">{XAI_UNITS[signal.feature]}</span>
    </span>
  )
}

function EvidenceDiagnosisCard({ active, ai, data, scenario = 'leak', segment, live, setPage }) {
  const [showReasoning, setShowReasoning] = useState(true)
  const last = data?.at(-1)
  const profile = SCENARIO_PROFILES[scenario] || SCENARIO_PROFILES.leak

  const expl = useMemo(() => {
    if (!active || !last) return null
    if (ai?.explanation) return ai.explanation
    if (ai && (ai.primaryHypothesis || ai.causes)) {
      return synthesizeExplanationFromAi(ai, last, profile)
    }
    return mockExplanation(last, profile)
  }, [active, ai, last, profile])

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-sm font-medium">AI Evidence &amp; Diagnosis</CardTitle>
          <CardDescription>
            {!active
              ? 'No anomaly selected'
              : live
                ? 'Backend explanation from live telemetry, anomaly score and ranked causes'
                : 'Cached mock explanation (backend unreachable)'}
          </CardDescription>
        </div>
        {active && (
          <Button size="sm" variant="ghost" onClick={() => setShowReasoning((s) => !s)}>
            {showReasoning ? 'Hide reasoning' : 'View reasoning'}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {!active || !expl ? (
          <p className="text-sm text-muted-foreground">Select an anomaly to see why it was detected.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{expl.diagnosis.primary}</span>
                <Badge variant={expl.severity === 'HIGH' ? 'destructive' : 'outline'}>{expl.severity}</Badge>
              </div>
              <span className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{expl.confidence}%</span> confidence
              </span>
            </div>
            <p className="text-sm text-muted-foreground">{expl.summary}</p>
            {showReasoning && (
              <>
                <Separator />
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Why this was detected</p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Signal</TableHead>
                        <TableHead>Reading</TableHead>
                        <TableHead>Baseline</TableHead>
                        <TableHead>Change</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {expl.signals.map((s) => (
                        <TableRow key={s.feature}>
                          <TableCell>
                            <div className="font-medium">{XAI_LABELS[s.feature] ?? s.feature}</div>
                            <div className="text-xs text-muted-foreground">{s.reason}</div>
                          </TableCell>
                          <TableCell><SignalValue signal={s} /></TableCell>
                          <TableCell className="text-muted-foreground">
                            {s.feature === 'pressure' || s.feature === 'level'
                              ? `${Number(s.baseline).toFixed(1)} ${XAI_UNITS[s.feature]}`
                              : `${fmt(s.baseline)} ${XAI_UNITS[s.feature]}`}
                          </TableCell>
                          <TableCell className="font-medium">
                            {s.change_percent >= 0 ? '+' : ''}{s.change_percent}%
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Model signal</p>
                  <p className="mt-1 text-sm">
                    {expl.model.name} · Anomaly score{' '}
                    <span className="font-medium">{Number(expl.model.anomaly_score).toFixed(2)}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">{expl.model.interpretation}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Domain evidence is derived from baseline deviations and the ranked hydraulic rules, not from model internals.
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Alternative diagnoses</p>
                  <div className="mt-2 space-y-2">
                    {expl.diagnosis.alternatives.length === 0 && (
                      <p className="text-xs text-muted-foreground">No alternatives ranked.</p>
                    )}
                    {expl.diagnosis.alternatives.map((a) => (
                      <div key={a.cause}>
                        <div className="flex items-center justify-between text-sm">
                          <span>{a.cause}</span>
                          <span className="font-medium">{a.confidence}%</span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary">
                          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${a.confidence}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <Separator />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    Affected segment: <span className="font-medium text-foreground">{segment}</span> · Confidence is a system estimate, not a guaranteed probability.
                  </p>
                  <Button size="sm" variant="outline" onClick={() => setPage('whatif')}>
                    Open in What-If
                  </Button>
                </div>
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

/* --------------------- Temporal Intelligence --------------------- */

function mockTemporal(last, data) {
  // Labeled offline fallback: simplified causal grades from the actual feed.
  const nums = (k) => (data || []).map((d) => Number(d[k])).filter((v) => Number.isFinite(v))
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
  const band = (absPct, hi, md) => (absPct >= hi ? 'HIGH' : absPct >= md ? 'MEDIUM' : 'LOW')
  const toMin = (t) => {
    const m = String(t ?? '').match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*$/)
    if (!m) return null
    return Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(m[3]) / 60 : 0)
  }
  const rawTimes = (data || []).map((d) => toMin(d.time))
  const times = rawTimes.every((v) => v != null)
    ? rawTimes.map((v, i, a) => (i > 0 && v < a[i - 1] - 720 ? v + 1440 : v))
    : (data || []).map((_, i) => i * 5)
  const flows = nums('flow')
  const press = nums('pressure')
  const k = Math.max(1, Math.floor(flows.length / 3))
  const refF = mean(flows.slice(0, k)) || 8000
  const refP = mean(press.slice(0, k)) || 4.0
  const fPct = ((Number(last?.flow) - refF) / Math.abs(refF)) * 100
  const pPct = ((Number(last?.pressure) - refP) / Math.abs(refP)) * 100
  const fDev = band(Math.abs(fPct), 25, 12)
  const pDev = band(Math.abs(pPct), 15, 8)
  const tail = Math.min(6, flows.length)
  const slope = (arr) => {
    if (arr.length < 2) return 0
    const n = arr.length
    const mx = (n - 1) / 2
    const my = mean(arr)
    let sxx = 0
    let sxy = 0
    arr.forEach((y, i) => { sxx += (i - mx) * (i - mx); sxy += (i - mx) * (y - my) })
    return sxx > 0 ? sxy / sxx : 0
  }
  const spanMin = times.length >= 2 ? Math.max(5, times[times.length - 1] - times[Math.max(0, times.length - tail)]) : 5
  const trendPct = (arr, ref) => {
    if (arr.length < 2 || !ref) return 0
    const perStep = slope(arr)
    const minutesPerStep = spanMin / (arr.length - 1)
    return ((perStep / Math.max(minutesPerStep, 1e-9)) * 30) / Math.abs(ref) * 100
  }
  const fT = trendPct(flows.slice(-tail), refF)
  const pT = trendPct(press.slice(-tail), refP)
  const tGrade = Math.abs(fT) >= 12 || Math.abs(pT) >= 6 ? 'HIGH' : Math.abs(fT) >= 5 || Math.abs(pT) >= 2.5 ? 'MEDIUM' : 'LOW'
  const flags = flows.map((_, i) => {
    const fw = flows.slice(0, i + 1)
    const pw = press.slice(0, i + 1)
    const kk = Math.max(1, Math.floor(fw.length / 3))
    const rf = mean(fw.slice(0, kk)) || 8000
    const rp = mean(pw.slice(0, kk)) || 4.0
    return Math.abs(((fw[i] - rf) / Math.abs(rf)) * 100) >= 12 || Math.abs(((pw[i] - rp) / Math.abs(rp)) * 100) >= 8
  })
  let run = 0
  for (let i = flags.length - 1; i >= 0 && flags[i]; i--) run++
  const horizon = Math.min(flags.length, 12)
  const hRun = flags.slice(-horizon).reverse().findIndex((f) => !f)
  const inH = hRun === -1 ? Math.min(run, horizon) : hRun
  const ratio = horizon ? inH / horizon : 0
  const persistence = run >= 3 && ratio >= 0.4 ? 'HIGH' : run >= 2 && ratio >= 0.6 ? 'HIGH' : run >= 2 && ratio >= 0.25 ? 'MEDIUM' : ratio >= 0.5 ? 'MEDIUM' : 'LOW'
  const priorF = flows.slice(0, -1)
  const priorP = press.slice(0, -1)
  let outside = 0
  if (priorF.length && Number.isFinite(Number(last?.flow))) {
    const lo = Math.min(...priorF)
    const hi = Math.max(...priorF)
    if (Number(last.flow) < lo || Number(last.flow) > hi) outside++
  }
  if (priorP.length && Number.isFinite(Number(last?.pressure))) {
    const lo = Math.min(...priorP)
    const hi = Math.max(...priorP)
    if (Number(last.pressure) < lo || Number(last.pressure) > hi) outside++
  }
  const context = outside >= 2 ? 'HIGH' : outside >= 1 ? 'MEDIUM' : 'LOW'
  const val = { HIGH: 1, MEDIUM: 0.55, LOW: 0.15 }
  const score = Math.round(((val[fDev] + val[pDev] + val[tGrade] + val[persistence] + val[context]) / 5) * 100) / 100
  const why = []
  if (fDev !== 'LOW') why.push(`Flow ${fPct >= 0 ? '+' : ''}${fPct.toFixed(1)}% vs window baseline — ${fDev} deviation.`)
  if (pDev !== 'LOW') why.push(`Pressure ${pPct >= 0 ? '+' : ''}${pPct.toFixed(1)}% vs window baseline — ${pDev} deviation.`)
  if (tGrade !== 'LOW') why.push(`Short-term trend moving (${fT.toFixed(1)}% flow / ${pT.toFixed(1)}% pressure per 30 min) — ${tGrade} trend.`)
  if (persistence !== 'LOW') why.push(`Abnormal pattern persisted (${run} recent points anomalous).`)
  if (!why.length) why.push('Readings track their recent baselines with no sustained abnormal pattern.')
  return {
    score,
    factors: { flow_deviation: fDev, pressure_deviation: pDev, trend: tGrade, persistence, historical_context: context },
    why: why.slice(0, 4),
  }
}

function TemporalCard({ active, temporal, live }) {
  if (!active || !temporal) return null
  const factors = [
    ['Flow Deviation', temporal.factors.flow_deviation],
    ['Pressure Deviation', temporal.factors.pressure_deviation],
    ['Trend', temporal.factors.trend],
    ['Persistence', temporal.factors.persistence],
    ['Historical Context', temporal.factors.historical_context],
  ]
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-sm font-medium">Temporal Intelligence</CardTitle>
          <CardDescription>{live ? 'Recent behavior vs window baseline (backend, causal)' : 'Local estimate from feed (backend unreachable)'}</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Score</span>
          <span className="text-xl font-semibold">{Number(temporal.score).toFixed(2)}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {factors.map(([label, grade]) => (
            <div key={label} className="rounded-md border p-2 text-center">
              <p className="text-[11px] text-muted-foreground">{label}</p>
              <Badge variant={grade === 'HIGH' ? 'destructive' : 'outline'} className="mt-1">{grade}</Badge>
            </div>
          ))}
        </div>
        <div className="rounded-md bg-secondary p-3">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Why this was flagged</p>
          <ul className="mt-1 space-y-1">
            {(temporal.why ?? []).map((w) => (
              <li key={w} className="text-xs leading-5">{w}</li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  )
}

/* ------------------------------ Investigation ---------------------------- */

function InvestigationPage({ active, verify, verified, verifyResult, onExport, onExportPDF, data, scenario = 'leak', setScenario, setPage, onViewMap }) {
  const fallback = SCENARIO_PROFILES[scenario] || SCENARIO_PROFILES.leak
  const [ai, setAi] = useState(null)
  const [live, setLive] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!active && scenario === 'normal') {
      setAi(null)
      setLive(false)
      return
    }
    const payload = data && data.length ? data : []
    if (!payload.length) return
    postDetect(payload)
      .then((res) => {
        if (!cancelled) {
          setAi(res)
          setLive(true)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAi(null)
          setLive(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [active, scenario, data])

  const causes = ai?.causes?.map((c) => (Array.isArray(c) ? c : [c.cause, c.score])) ?? fallback.causes
  const evidence = ai?.evidence && ai.evidence.length ? ai.evidence : fallback.evidence
  const flowChg = ai?.deviation_pct ? `${ai.deviation_pct.flow >= 0 ? '+' : ''}${ai.deviation_pct.flow.toFixed(1)}%` : `${fallback.flowChange >= 0 ? '+' : ''}${fallback.flowChange}%`
  const pressChg = ai?.deviation_pct ? `${ai.deviation_pct.pressure >= 0 ? '+' : ''}${ai.deviation_pct.pressure.toFixed(1)}%` : `${fallback.pressureChange}%`
  const segment = ai?.location?.segment ?? fallback.location
  const locConf = ai?.location?.confidence ?? fallback.confidence
  const hypothesis = ai?.primaryHypothesis ?? fallback.primary ?? fallback.title
  const severity = ai?.severity ?? fallback.severity
  const anomalyScore = ai?.anomalyScore ?? null
  const pipe = ai?.pipeCondition ?? null
  const structuralAlert = active && severity === 'HIGH' && pipe?.state === 'Crack'
  const last = data?.at(-1)
  const temporal = ai?.temporal ?? (active && last ? mockTemporal(last, data) : null)
  const temporalLive = live && !!ai?.temporal
  const faultLoc = ai?.location?.latitude != null ? ai.location : getFaultLocation(segment)
  return (
    <div className="space-y-4">
      <PageSection
        eyebrow="Investigation"
        title="Why is the network abnormal?"
        action={
          <div className="flex flex-wrap items-center gap-2">
            {setScenario && (
              <select
                value={scenario}
                onChange={(e) => setScenario(e.target.value)}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs font-medium shadow-sm transition-colors focus:outline-none focus:ring-1 focus:ring-ring"
                aria-label="Select anomaly scenario"
              >
                <option value="leak">Pipeline leak</option>
                <option value="burst">Pipe burst</option>
                <option value="demand">Demand spike</option>
                <option value="sensor">Sensor fault</option>
                <option value="corrosion">Early corrosion</option>
              </select>
            )}
            {live ? <Badge variant="secondary">Live AI</Badge> : <Badge variant="outline">Mock fallback</Badge>}
            {verified ? <Badge variant="secondary">Verified</Badge> : <Badge variant="outline">Needs verification</Badge>}
          </div>
        }
      >
        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Incident snapshot</CardTitle>
              <CardDescription>{active ? `${segment} · ${ai ? `Zone ${ai.location?.zone}` : fallback.zone}` : 'No active incident'}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {active ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{structuralAlert ? `🚨 ${hypothesis} Detected` : hypothesis}</span>
                    <Badge variant={severity === 'HIGH' ? 'destructive' : 'outline'}>{severity}</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Stat label="Flow change" value={flowChg} alert />
                    <Stat label="Pressure change" value={pressChg} alert />
                  </div>
                  <Separator />
                  <dl className="space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Probable location</dt>
                      <dd className="font-medium">{segment} ({locConf}% confidence)</dd>
                    </div>
                    <div className="flex justify-between items-center">
                      <dt className="text-muted-foreground">Coordinates</dt>
                      <dd className="font-medium font-mono text-xs text-cyan-400 flex items-center gap-1">
                        <span>{faultLoc?.latitude ? `${Number(faultLoc.latitude).toFixed(4)}°, ${Number(faultLoc.longitude).toFixed(4)}°` : '—'}</span>
                        {onViewMap && faultLoc?.latitude != null && (
                          <button
                            onClick={() => onViewMap(faultLoc)}
                            className="hover:underline text-cyan-300 ml-1 cursor-pointer font-sans text-xs"
                            title="View on Map"
                          >
                            [Map]
                          </button>
                        )}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Primary hypothesis</dt>
                      <dd className="font-medium">{hypothesis}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">ML anomaly score</dt>
                      <dd className="font-medium">{anomalyScore != null ? anomalyScore.toFixed(2) : '—'}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Pipe condition</dt>
                      <dd className="font-medium">
                        {pipe ? `${pipe.state} (eddy ${Number(pipe.eddy).toFixed(2)})` : '—'}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Confidence</dt>
                      <dd className="font-medium">{ai?.confidence ?? fallback.confidence}%</dd>
                    </div>
                  </dl>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Trigger a simulated incident from the header.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Possible causes</CardTitle>
              <CardDescription>Ranked by the hybrid ML + rules model{live ? ' (live)' : ' (mock)'}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {causes.map(([cause, score]) => (
                <div key={cause}>
                  <div className="flex items-center justify-between text-sm">
                    <span>{cause}</span>
                    <span className="font-medium">{active ? score : 0}%</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary">
                    <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${active ? score : 0}%` }} />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <FaultLocationCard
          location={faultLoc}
          active={active}
          onViewMap={onViewMap}
          title={active ? 'Suspected Fault Location' : 'Asset Location'}
        />

        <EvidenceDiagnosisCard
          active={active}
          ai={ai}
          data={data}
          scenario={scenario}
          segment={segment}
          live={live}
          setPage={setPage}
        />

        <TemporalCard active={active} temporal={temporal} live={temporalLive} />

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Evidence</CardTitle>
            <CardDescription>
              {!active ? 'No evidence — system nominal' : live ? 'Backend evidence with deviation + topology' : 'Cached mock evidence'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {!active ? (
              <p className="text-sm text-muted-foreground">Trigger a simulated incident to generate evidence.</p>
            ) : (
              evidence.map((item) => (
                <div key={item} className="flex gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  <span>{item}</span>
                </div>
              ))
            )}
          </CardContent>
          <CardFooter className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">Compare the observed pattern with a simulated {segment} {hypothesis.toLowerCase()}.</p>
            <div className="flex gap-2">
              <Button size="sm" variant={verified ? 'secondary' : 'default'} onClick={verify}>
                {verified ? 'Verified' : 'Verify scenario'}
              </Button>
              <Button size="sm" variant="outline" onClick={onExportPDF}>
                <FileText /> Export PDF
              </Button>
              <Button size="sm" variant="outline" onClick={onExport}>
                <Download /> Export JSON
              </Button>
            </div>
          </CardFooter>
        </Card>

        {verifyResult && active && (
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-sm font-medium">Scenario verification — observed vs simulated</CardTitle>
                <CardDescription>
                  {verifyResult.hypothesis} at {verifyResult.segment} · {verifyResult.matchScore}% match ({verifyResult.evidenceStrength})
                </CardDescription>
              </div>
              <Badge variant={verifyResult.verified ? 'secondary' : 'outline'}>
                {verifyResult.verified ? 'SUPPORTED' : 'WEAK'}
              </Badge>
            </CardHeader>
            <CardContent>
              <VerifyChart observed={data} simulated={verifyResult.simulated} />
              <p className="mt-2 text-xs text-muted-foreground">{verifyResult.explanation}</p>
            </CardContent>
          </Card>
        )}
      </PageSection>
    </div>
  )
}

/* --------------------------------- Impact -------------------------------- */

function ImpactPage({ active, data, scenario = 'leak' }) {
  const fallback = SCENARIO_PROFILES[scenario] || SCENARIO_PROFILES.leak
  const [impact, setImpact] = useState(null)
  const [live, setLive] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!active) {
      setImpact(null)
      setLive(false)
      return
    }
    const payload = data && data.length ? data : []
    if (!payload.length) return
    postDetect(payload)
      .then((res) => {
        if (!cancelled) {
          setImpact(res)
          setLive(true)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setImpact(null)
          setLive(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [active, scenario, data])

  if (!active) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          No active incident. Trigger the simulated incident or pick burst / demand / sensor in Telemetry to populate the impact assessment.
        </CardContent>
      </Card>
    )
  }
  const loss = impact?.impact?.lossPerHour ?? fallback.lossPerHour
  const loss24 = impact?.impact?.loss24h ?? fallback.loss24h
  const zone = impact?.impact?.affectedZone ?? fallback.zone
  const users = impact?.impact?.affectedUsers ?? (fallback.zone === 'Zone C' ? 380 : 560)
  const severity = impact?.severity ?? fallback.severity
  const pipe = impact?.pipeCondition ?? null
  return (
    <div className="space-y-4">
      <PageSection
        eyebrow="Impact"
        title="Operational impact"
        description={live ? `Live backend estimate (${scenario}).` : 'Cached mock estimate.'}
        action={live ? <Badge variant="secondary">Live AI</Badge> : <Badge variant="outline">Mock fallback</Badge>}
      >
        <div className="grid gap-3 md:grid-cols-3">
          <Stat label="Est. loss" value={`${fmt(Math.round(loss))} L/hr`} alert={loss > 500} />
          <Stat label="24-hour projection" value={`${fmt(Math.round(loss24))} L`} alert={loss > 500} />
          <Stat label="Affected zone" value={zone} hint={`${users} users`} />
        </div>
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-sm font-medium">Priority: {severity}</CardTitle>
              <CardDescription>
                {severity === 'HIGH' ? 'Immediate investigation recommended.' : severity === 'MEDIUM' ? 'Schedule inspection.' : 'Monitor baseline.'}
              </CardDescription>
            </div>
            <Badge variant={severity === 'HIGH' ? 'destructive' : 'outline'}>{severity}</Badge>
          </CardHeader>
          <CardContent className="text-sm leading-6 text-muted-foreground">
            {scenario === 'demand'
              ? 'Consumption-driven rise — no pipe loss. No isolation needed; monitor demand peak.'
              : scenario === 'corrosion'
                ? 'Wall degradation without a breach — no water loss yet. Schedule inspection; isolation saves nothing.'
                : scenario === 'sensor'
                  ? 'Pressure transmitter disagreement with healthy wall — false alarm. Check the sensor, not the pipe.'
                  : scenario === 'burst'
                    ? `Burst-scale loss at ${impact?.location?.segment ?? fallback.location}. Isolate to stop major loss, operator must approve.`
                    : `Loss continues while unresolved. Isolating ${impact?.location?.segment ?? fallback.location} reduces loss but affects ${zone} service. Final intervention stays with a qualified operator.`}
            {pipe && (
              <span className="mt-1 block text-xs">Pipe condition: {pipe.state} (eddy {Number(pipe.eddy).toFixed(2)}) — {pipe.detail}.</span>
            )}
          </CardContent>
        </Card>
      </PageSection>
    </div>
  )
}

/* --------------------------------- What-If ------------------------------- */

function WhatIfPage({ active, data, scenario = 'leak' }) {
  const [option, setOption] = useState('isolate')
  const [ran, setRan] = useState(false)
  const [throttle, setThrottle] = useState(50)
  const [result, setResult] = useState(null)
  const [live, setLive] = useState(false)
  const [loading, setLoading] = useState(false)
  const [baselineLoss, setBaselineLoss] = useState(null)
  const [detectInfo, setDetectInfo] = useState(null)
  const [compareResult, setCompareResult] = useState(null)
  const [compareLive, setCompareLive] = useState(false)
  const [compareLoading, setCompareLoading] = useState(false)
  const chosen = whatIfOptions[option]

  const severityForScenario = { leak: 'HIGH', burst: 'HIGH', demand: 'MEDIUM', sensor: 'LOW', corrosion: 'MEDIUM', normal: 'NORMAL' }
  const segmentForScenario = { leak: 'B2 → B3', burst: 'B2 → B3', demand: 'N1 → Zone C', sensor: 'N1 → B2', corrosion: 'B2 → B3', normal: 'B2 → B3' }

  // Offline fallback mirrors backend/app/decision.py defaults so the demo still ranks without API.
  const localCompareFallback = (incidentKey, baseline) => {
    const base = baseline ?? (incidentKey === 'burst' ? 7000 : incidentKey === 'leak' ? 3500 : 0)
    const costs = {
      isolate: { usd: 2500, cost: 65, disruption: 'High', dScore: 75 },
      reducePressure: { usd: 800, cost: 35, disruption: 'Low', dScore: 25 },
      bypassRoute: { usd: 1800, cost: 50, disruption: 'Medium', dScore: 40 },
      doNothing: { usd: 0, cost: 0, disruption: 'None', dScore: 5 },
    }
    const names = { isolate: 'isolate', reducePressure: 'throttle', bypassRoute: 'reroute', doNothing: 'do_nothing' }
    const labels = { isolate: 'Isolate', reducePressure: 'Throttle', bypassRoute: 'Reroute', doNothing: 'Do Nothing' }
    const rows = Object.entries(whatIfOptions).map(([key, item]) => {
      let afterLoss = item.after.loss
      if (base <= 0) afterLoss = 0
      else if (key === 'reducePressure') {
        const factor = (100 - throttle) / 100
        afterLoss = Math.round(base * (0.45 + factor * 0.55))
      } else afterLoss = Math.round(item.after.loss * (base / 3500))
      const beforeLoss = Math.round(base)
      const waterRed = beforeLoss > 0 ? Math.max(0, Math.round(((beforeLoss - afterLoss) / beforeLoss) * 1000) / 10) : 0
      const c = costs[key]
      const pressureBonus = item.after.pressure >= 3.5 ? 10 : item.after.pressure < 3.1 ? -5 : 0
      const riskRed = base > 0
        ? Math.max(0, Math.min(100, Math.round((waterRed * 0.85 - c.dScore * 0.15 + pressureBonus) * 10) / 10))
        : Math.max(0, Math.round((5 - c.dScore * 0.1) * 10) / 10)
      const usersNorm = Math.min(100, (item.after.users / 560) * 100)
      const service = Math.max(0, Math.min(100, Math.round((100 - (0.6 * c.dScore + 0.4 * usersNorm)) * 10) / 10))
      const score = Math.round((0.3 * waterRed + 0.3 * riskRed + 0.2 * service + 0.1 * (100 - c.cost) + 0.1 * (100 - c.dScore)) * 10) / 10
      return {
        action: names[key], scenario: key, label: labels[key], score,
        water_loss_reduction: waterRed, water_saved_per_hour: Math.max(0, beforeLoss - afterLoss),
        risk_reduction: riskRed, affected_users: item.after.users,
        service_disruption: c.disruption, disruption_score: c.dScore,
        estimated_cost_usd: c.usd, network_impact: { loss_before: beforeLoss, loss_after: afterLoss, pressure_after: item.after.pressure },
      }
    })
    rows.sort((a, b) => b.score - a.score)
    rows.forEach((r, i) => { r.rank = i + 1 })
    const best = rows[0]
    return {
      options: rows, recommended_action: best.action,
      reason: `${best.label} offers the best overall trade-off across configured cost, simulated impact (${best.water_loss_reduction}% loss reduction) and risk metrics (score ${best.score}). Operator review required.`,
      why: [
        `Water-loss reduction ${best.water_loss_reduction}% (${best.water_saved_per_hour.toLocaleString()} L/hr saved).`,
        `Risk reduction ${best.risk_reduction}% with disruption ${best.service_disruption} (${best.affected_users} users).`,
        `Planning cost $${best.estimated_cost_usd.toLocaleString()} — configured estimate, not a quotation.`,
      ],
      cost_basis: 'Configured planning estimates for MVP comparison only.',
      operatorNote: 'Decision support only — no intervention is executed automatically.',
    }
  }

  const compareAll = async () => {
    setCompareLoading(true)
    try {
      const res = await postDecisionCompare({
        incident: scenario,
        severity: detectInfo?.severity ?? severityForScenario[scenario] ?? 'HIGH',
        segment: detectInfo?.location?.segment ?? segmentForScenario[scenario] ?? 'B2 → B3',
        baselineLoss,
        valveThrottle: throttle,
      })
      setCompareResult(res)
      setCompareLive(true)
    } catch {
      setCompareResult(localCompareFallback(scenario, baselineLoss))
      setCompareLive(false)
    } finally {
      setCompareLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    if (!active || !data?.length) {
      setBaselineLoss(null)
      setDetectInfo(null)
      setCompareResult(null)
      return
    }
    postDetect(data)
      .then((res) => {
        if (!cancelled) {
          setBaselineLoss(res?.impact?.lossPerHour ?? null)
          setDetectInfo(res)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [active, scenario])

  const fallbackAfterLoss = useMemo(() => {
    if (option === 'reducePressure') {
      const factor = (100 - throttle) / 100
      return Math.round(3500 * (0.45 + factor * 0.55))
    }
    return chosen.after.loss
  }, [option, throttle, chosen])

  const display = result ?? {
    label: chosen.label,
    before: chosen.before,
    after: { ...chosen.after, loss: fallbackAfterLoss },
    lossReductionPct: Math.round(((chosen.before.loss - fallbackAfterLoss) / chosen.before.loss) * 100),
    notes: chosen.notes,
  }

  const run = async () => {
    setLoading(true)
    try {
      const res = await postWhatIf(option, throttle, scenario, baselineLoss)
      setResult(res)
      setLive(true)
    } catch {
      setResult(null)
      setLive(false)
    } finally {
      setRan(true)
      setLoading(false)
    }
  }

  if (!active) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          No active incident. Trigger the simulated incident or pick burst / demand / sensor in Telemetry to enable what-if analysis.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <PageSection
        eyebrow="Decision support"
        title="What-If Studio"
        description={
          ran
            ? live
              ? `Live Render backend result for ${scenario} (baseline ${baselineLoss != null ? `${fmt(Math.round(baselineLoss))} L/hr` : '…' }).`
              : 'Cached mock result.'
            : `Simulated outcomes for ${scenario}. Operator controlled.`
        }
        action={
          <div className="flex gap-2">
            {ran && (live ? <Badge variant="secondary">Live API</Badge> : <Badge variant="outline">Mock fallback</Badge>)}
            <Badge variant="outline">Advisory only</Badge>
          </div>
        }
      >
        <div className="grid gap-4 xl:grid-cols-5">
          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle className="text-sm font-medium">Intervention</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {Object.entries(whatIfOptions).map(([key, item]) => (
                <button
                  key={key}
                  onClick={() => {
                    setOption(key)
                    setRan(false)
                    setResult(null)
                    setCompareResult(null)
                  }}
                  className={`w-full rounded-md border p-3 text-left text-sm transition-colors ${
                    option === key ? 'border-primary bg-accent' : 'hover:bg-accent/50'
                  }`}
                >
                  <span className="font-medium">{item.label}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">{item.notes}</span>
                </button>
              ))}
              {option === 'reducePressure' && (
                <div className="rounded-md border p-3">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Valve throttle</span>
                    <span className="font-medium">{throttle}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={throttle}
                    onChange={(e) => {
                      setThrottle(Number(e.target.value))
                      setRan(false)
                      setCompareResult(null)
                    }}
                    className="mt-2 w-full accent-primary"
                  />
                </div>
              )}
              <Button className="w-full" onClick={run} disabled={loading}>
                {loading ? 'Running…' : 'Run simulation'}
              </Button>
            </CardContent>
          </Card>

          <Card className="xl:col-span-3">
            <CardHeader>
              <CardTitle className="text-sm font-medium">{ran ? 'Simulated result' : 'Ready'}</CardTitle>
              <CardDescription>{ran ? display.label : 'Select an intervention and run the simulation.'}</CardDescription>
            </CardHeader>
            {ran && (
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <Stat label="Loss reduction" value={`${display.lossReductionPct}%`} />
                  <Stat label="Pressure after" value={`${display.after.pressure.toFixed(1)} bar`} />
                  <Stat label="Users affected" value={display.after.users} alert={display.after.users > 0} />
                </div>
                <div className="grid gap-3 sm:grid-cols-2 text-sm">
                  <div className="rounded-md border p-4">
                    <p className="text-xs text-muted-foreground">Before</p>
                    <p className="mt-1 text-xl font-semibold">{fmt(display.before.loss)} <span className="text-xs font-normal text-muted-foreground">L/hr</span></p>
                  </div>
                  <div className="rounded-md border border-primary/30 bg-accent/50 p-4">
                    <p className="text-xs text-muted-foreground">After</p>
                    <p className="mt-1 text-xl font-semibold">{fmt(display.after.loss)} <span className="text-xs font-normal text-muted-foreground">L/hr</span></p>
                  </div>
                </div>
                <p className="rounded-md bg-secondary p-3 text-xs leading-5 text-secondary-foreground">{display.notes}</p>
                {display.operatorNote && <p className="text-xs text-muted-foreground">{display.operatorNote}</p>}
              </CardContent>
            )}
          </Card>
        </div>
        {/* Cost-aware decision comparison (PRD MVP extension) */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-sm font-medium">Cost-aware what-if analysis</CardTitle>
              <CardDescription>
                {compareResult
                  ? (compareLive ? 'Live backend ranking — configured planning estimates.' : 'Cached mock ranking (API offline) — planning estimates.')
                  : 'Compare Isolate / Throttle / Reroute / Do Nothing side-by-side.'}
              </CardDescription>
            </div>
            <div className="flex gap-2">
              {compareResult && (compareLive ? <Badge variant="secondary">Live API</Badge> : <Badge variant="outline">Mock fallback</Badge>)}
              <Badge variant="outline">Advisory only</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button className="w-full sm:w-auto" onClick={compareAll} disabled={compareLoading}>
              {compareLoading ? 'Comparing…' : compareResult ? 'Re-run comparison' : 'Compare all 4 options'}
            </Button>
            {compareResult && (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Metric</TableHead>
                      {compareResult.options.map((o) => (
                        <TableHead key={o.action} className={o.rank === 1 ? 'font-semibold text-foreground' : ''}>
                          {o.rank === 1 ? `⭐ ${o.label}` : o.label} · {o.score}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell className="font-medium">Water-loss reduction</TableCell>
                      {compareResult.options.map((o) => (
                        <TableCell key={o.action}>{o.water_loss_reduction}%</TableCell>
                      ))}
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-medium">Risk reduction</TableCell>
                      {compareResult.options.map((o) => (
                        <TableCell key={o.action}>{o.risk_reduction}%</TableCell>
                      ))}
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-medium">Users affected</TableCell>
                      {compareResult.options.map((o) => (
                        <TableCell key={o.action}>{o.affected_users}</TableCell>
                      ))}
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-medium">Disruption</TableCell>
                      {compareResult.options.map((o) => (
                        <TableCell key={o.action}>{o.service_disruption}</TableCell>
                      ))}
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-medium">Est. cost (planning)</TableCell>
                      {compareResult.options.map((o) => (
                        <TableCell key={o.action}>${fmt(o.estimated_cost_usd)}</TableCell>
                      ))}
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-medium">Pressure after</TableCell>
                      {compareResult.options.map((o) => (
                        <TableCell key={o.action}>{Number(o.network_impact?.pressure_after ?? 0).toFixed(1)} bar</TableCell>
                      ))}
                    </TableRow>
                  </TableBody>
                </Table>
                <div className="rounded-md border border-primary/30 bg-accent/50 p-4">
                  <p className="text-sm font-medium">
                    ⭐ Recommended for review: {compareResult.options[0].label} ({compareResult.options[0].score})
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{compareResult.reason}</p>
                  <ul className="mt-2 space-y-1">
                    {(compareResult.why ?? []).map((w) => (
                      <li key={w} className="flex gap-2 text-xs text-muted-foreground">
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                        <span>{w}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[11px] text-muted-foreground">{compareResult.cost_basis}</p>
                  {compareResult.operatorNote && <p className="mt-1 text-[11px] text-muted-foreground">{compareResult.operatorNote}</p>}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </PageSection>
    </div>
  )
}

/* --------------------------------- History ------------------------------- */

function HistoryPage({ setPage }) {
  const [filter, setFilter] = useState('')
  const [rows, setRows] = useState(incidents)
  const [source, setSource] = useState('mock')
  useEffect(() => {
    let cancelled = false
    fetchIncidents()
      .then((j) => {
        if (!cancelled && j?.incidents?.length) {
          setRows(j.incidents)
          setSource(j.source ?? 'supabase')
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  const filtered = rows.filter(
    (i) => (i.title || '').toLowerCase().includes(filter.toLowerCase()) || (i.id || '').toLowerCase().includes(filter.toLowerCase())
  )
  return (
    <div className="space-y-4">
      <PageSection
        eyebrow="History"
        title="Incidents"
        description={source === 'supabase' ? 'Live Supabase register — auto-filed by AI.' : 'Cached mock register (DB offline).'}
        action={
          <div className="flex items-center gap-2">
            {source === 'supabase' ? <Badge variant="secondary">Live DB</Badge> : <Badge variant="outline">Mock fallback</Badge>}
            <Input placeholder="Search…" value={filter} onChange={(e) => setFilter(e.target.value)} className="max-w-[180px]" />
          </div>
        }
      >
        <Card>
          <CardContent className="pt-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Incident</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <div className="font-medium">{item.id}</div>
                      <div className="text-xs text-muted-foreground">{item.title}</div>
                    </TableCell>
                    <TableCell>{item.type}</TableCell>
                    <TableCell>{item.location}</TableCell>
                    <TableCell>{item.started}</TableCell>
                    <TableCell>
                      <Badge variant={item.severity === 'HIGH' ? 'destructive' : 'outline'}>{item.severity}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={item.status === 'Resolved' ? 'secondary' : 'outline'}>{item.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex justify-end pt-4">
              <Button variant="outline" size="sm" onClick={() => setPage('monitoring')}>
                Explore telemetry
              </Button>
            </div>
          </CardContent>
        </Card>
      </PageSection>
    </div>
  )
}

/* --------------------------------- Settings ------------------------------ */

function SettingsPage() {
  const [backend, setBackend] = useState({ online: false, checked: false })
  useEffect(() => {
    checkHealth()
      .then((r) => setBackend({ online: r.online, checked: true }))
      .catch(() => setBackend({ online: false, checked: true }))
  }, [])
  const env = [
    ['Data source', backend.checked ? (backend.online ? 'Live API + mock fallback' : 'Mock (API offline)') : 'Checking…'],
    ['Analytics', 'Hybrid ML + rules'],
    ['Network model', 'NetworkX topology'],
    ['Simulation', 'FastAPI scenario engine'],
    ['Deployment', 'React + Vite'],
  ]
  return (
    <div className="space-y-4">
      <PageSection eyebrow="Prototype" title="Settings">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Backend</CardTitle>
              <CardDescription>FastAPI connection status</CardDescription>
            </CardHeader>
            <CardContent>
              {backend.checked ? (
                backend.online ? (
                  <Badge variant="secondary">Online</Badge>
                ) : (
                  <Badge variant="destructive">Offline — using mock data</Badge>
                )
              ) : (
                <Badge variant="outline">Checking…</Badge>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Environment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              {env.map(([a, b]) => (
                <div key={a} className="flex items-center justify-between border-b py-1.5 last:border-0">
                  <span className="text-muted-foreground">{a}</span>
                  <span className="font-medium">{b}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </PageSection>
    </div>
  )
}

/* ------------------------------ Legal pages ------------------------------ */

function PrivacyPage() {
  return (
    <div className="space-y-4">
      <PageSection eyebrow="Legal" title="Privacy Policy" description="Effective for this demonstration deployment.">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Data this demo handles</CardTitle>
            <CardDescription>Simulated network data only</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm leading-6 text-muted-foreground">
            <p>All telemetry (flow, pressure, consumption, tank level) is generated by the built-in simulator. No real customer data, meter readings, or personal information are collected.</p>
            <p>Incident records filed to the history register contain only operational fields: scenario type, network segment, severity, estimated loss, and model evidence. They contain no names, addresses, or account data.</p>
            <p>Connection status checks call the configured backend health endpoint. No tracking cookies or third-party analytics are embedded in this interface.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Operator responsibility</CardTitle>
          </CardHeader>
          <CardContent className="text-sm leading-6 text-muted-foreground">
            Recommendations are advisory. A qualified operator reviews evidence and remains accountable for any intervention. Do not connect this demo to live control hardware.
          </CardContent>
        </Card>
      </PageSection>
    </div>
  )
}

function TermsPage() {
  return (
    <div className="space-y-4">
      <PageSection eyebrow="Legal" title="Terms and Conditions" description="Rules for using this demonstration interface.">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Permitted use</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm leading-6 text-muted-foreground">
            <p>HydraNexus is provided as a hackathon demonstration for evaluating simulated water-network decision support: monitoring, investigation, verification, impact review, and what-if comparison.</p>
            <p>All outputs are estimates from simulated data. They are not engineering advice and must not drive real valves, pumps, or isolation actions.</p>
            <p>Do not upload personal data, rely on demo history as an operational record, or represent simulated results as live utility performance.</p>
          </CardContent>
        </Card>
      </PageSection>
    </div>
  )
}

/* ----------------------------------- App --------------------------------- */

export default function App() {
  const [page, setPage] = useState('overview')
  const [dataSourceMode, setDataSourceMode] = useState('demo')
  const [active, setActive] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [scenario, setScenario] = useState('normal')
  const [verified, setVerified] = useState(false)
  const [verifyResult, setVerifyResult] = useState(null)
  const [toast, setToast] = useState(null)
  const [backendOnline, setBackendOnline] = useState(false)
  const [mapModalOpen, setMapModalOpen] = useState(false)
  const [selectedMapLocation, setSelectedMapLocation] = useState(null)

  const handleOpenMap = (loc) => {
    const defaultLoc = getFaultLocation(scenario === 'demand' ? 'N1 → Zone C' : scenario === 'sensor' ? 'N1 → B2' : 'B2 → B3')
    setSelectedMapLocation(loc || defaultLoc)
    setMapModalOpen(true)
  }

  const handleDataSourceModeChange = (newMode) => {
    setDataSourceMode(newMode)
    if (page !== 'monitoring') {
      setPage('monitoring')
    }
  }

  useEffect(() => {
    checkHealth()
      .then((r) => setBackendOnline(r.online))
      .catch(() => setBackendOnline(false))
  }, [])

  const [showLanding, setShowLanding] = useState(() => {
    if (typeof window !== 'undefined') {
      return !sessionStorage.getItem('hydranexus_briefing_seen')
    }
    return true
  })

  const handleLandingComplete = () => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('hydranexus_briefing_seen', '1')
    }
    setShowLanding(false)
  }

  const handleReplayBriefing = () => {
    setShowLanding(true)
  }

  const data = useMemo(
    () =>
      scenario === 'leak'
        ? leakTelemetry
        : scenario === 'burst'
          ? burstTelemetry
          : scenario === 'demand'
            ? demandTelemetry
            : scenario === 'sensor'
              ? sensorTelemetry
              : scenario === 'corrosion'
                ? corrosionTelemetry
                : normalTelemetry,
    [scenario]
  )

  const handleScenarioChange = (s) => {
    setScenario(s)
    const nextActive = s !== 'normal'
    setActive(nextActive)
    setVerified(false)
    setVerifyResult(null)
    const toastMap = {
      leak: { message: 'Pipeline leak anomaly detected on segment B2 → B3.', type: 'danger' },
      burst: { message: '🚨 Pipe burst rupture detected on segment B2 → B3 (major flow surge).', type: 'danger' },
      demand: { message: 'Consumer demand surge detected in Zone C.', type: 'info' },
      sensor: { message: 'Suspected sensor fault (false alarm) on segment N1 → B2.', type: 'info' },
      corrosion: { message: 'Early pipe corrosion watch flagged on segment B2 → B3.', type: 'info' },
      normal: { message: 'Returned to normal network baseline.', type: 'success' },
    }
    const t = toastMap[s] || { message: `Scenario switched to ${s}.`, type: 'info' }
    setToast(t)
  }

  const trigger = () => {
    if (active) {
      handleScenarioChange('normal')
    } else {
      handleScenarioChange(scenario === 'normal' ? 'leak' : scenario)
    }
  }

  const doVerify = async () => {
    setVerified(true)
    try {
      const hypothesisMap = { leak: 'leak', burst: 'burst', demand: 'demand', sensor: 'sensor', corrosion: 'corrosion' }
      const segmentMap = { leak: 'B2 → B3', burst: 'B2 → B3', demand: 'N1 → Zone C', sensor: 'N1 → B2', corrosion: 'B2 → B3' }
      const hypothesis = hypothesisMap[scenario] ?? 'leak'
      const res = await postVerify(data, hypothesis, segmentMap[scenario] ?? 'B2 → B3')
      setVerifyResult(res)
      const urgent = res.verified && res.matchScore >= 75 && (hypothesis === 'leak' || hypothesis === 'burst')
      setToast({ message: `${urgent ? '🚨 ' : ''}Verification: ${res.matchScore}% (${res.evidenceStrength}).`, type: res.verified ? 'success' : 'info' })
    } catch {
      setVerifyResult(null)
      setToast({ message: 'Verified against the local mock model.', type: 'success' })
    }
  }

  const exportReport = () => {
    const suspectedSegment = scenario === 'demand' ? 'N1 → Zone C' : scenario === 'sensor' ? 'N1 → B2' : 'B2 → B3'
    const gisLoc = getFaultLocation(suspectedSegment)
    const report = {
      timestamp: new Date().toISOString(),
      activeIncident: active ? {
        ...(SCENARIO_PROFILES[scenario] || incidents[0]),
        gis_location: gisLoc,
      } : null,
      telemetrySnapshot: data,
      systemStatus: active ? 'ALERT' : 'NORMAL',
    }
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `hydranexus-incident-report-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
    setToast({ message: 'Incident report exported.', type: 'success' })
  }

  const exportPDF = async () => {
    if (!active) {
      setToast({ message: 'No active incident to report.', type: 'info' })
      return
    }
    const esc = (v) => String(v ?? '—').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    let ai = null
    try {
      ai = await postDetect(data)
    } catch {
      ai = null
    }
    const last = data?.at(-1) ?? {}
    const live = !!ai
    const profile = SCENARIO_PROFILES[scenario] || SCENARIO_PROFILES.leak
    const hyp = ai?.primaryHypothesis ?? profile.primary ?? profile.title
    const sev = ai?.severity ?? profile.severity ?? 'Unknown'
    const conf = ai?.confidence ?? profile.confidence ?? '—'
    const seg = ai?.location?.segment ?? profile.location ?? '—'
    const zone = ai?.location?.zone ? `Zone ${ai.location.zone}` : profile.zone ?? '—'
    const locConf = ai?.location?.confidence ?? fallback?.confidence ?? '—'
    const locObj = ai?.location?.latitude != null ? ai.location : getFaultLocation(seg)
    const locGisText = locObj?.gis_configured && locObj?.latitude != null
      ? `${Number(locObj.latitude).toFixed(4)}° N, ${Number(locObj.longitude).toFixed(4)}° E (${locObj.asset_name || locObj.asset_id}) [Source: ${locObj.location_source || 'Demo GIS'}]`
      : 'Location coordinates unavailable (GIS not configured)'
    const score = ai?.anomalyScore != null ? Number(ai.anomalyScore).toFixed(2) : (last?.anomalyScore != null ? Number(last.anomalyScore).toFixed(2) : '—')
    const pipe = ai?.pipeCondition ? `${ai.pipeCondition.state} (eddy ${Number(ai.pipeCondition.eddy).toFixed(2)})` : '—'
    const tFactors = ai?.temporal ? Object.entries(ai.temporal.factors).map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`).join(' · ') : ''
    const tScore = ai?.temporal ? `${Number(ai.temporal.score).toFixed(2)} (${tFactors})` : '—'
    const dev = ai?.deviation_pct ?? {}
    const devTxt = (k, unit) => (dev[k] != null ? `${dev[k] >= 0 ? '+' : ''}${Number(dev[k]).toFixed(1)}% ${unit}` : '—')
    const causeRows = (ai?.causes ?? profile.causes ?? [])
      .map((c) => {
        const cause = Array.isArray(c) ? c[0] : c.cause
        const score = Array.isArray(c) ? c[1] : c.score
        return `<tr><td>${esc(cause)}</td><td>${esc(score)}%</td></tr>`
      })
      .join('') || '<tr><td colspan="2">Ranked causes unavailable offline.</td></tr>'
    const evidenceItems = (ai?.evidence && ai.evidence.length ? ai.evidence : profile.evidence)
      .map((e) => `<li>${esc(e)}</li>`)
      .join('') || '<li>Evidence unavailable offline.</li>'
    const v = verifyResult
    const verifySection = v
      ? `<p>Hypothesis <strong>${esc(v.hypothesis)}</strong> at ${esc(v.segment)} — match ${esc(v.matchScore)}% (${esc(v.evidenceStrength)}), ${v.verified ? 'SUPPORTED' : 'WEAK'}.</p><p>${esc(v.explanation)}</p>`
      : '<p>Scenario verification was not run for this report.</p>'
    const simRows = v?.simulated
      ? v.simulated
          .map((s, i) => {
            const o = data?.[i]
            return `<tr><td>${esc(o?.time ?? s.time)}</td><td>${o ? fmt(o.flow) : '—'}</td><td>${fmt(s.flow)}</td></tr>`
          })
          .join('')
      : ''
    const impact = ai?.impact ?? { lossPerHour: profile.lossPerHour, loss24h: profile.loss24h, affectedZone: profile.zone, affectedUsers: profile.zone === 'Zone C' ? 380 : 560 }
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>HydraNexus Incident Report</title><style>
body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:32px;font-size:12px}
h1{font-size:20px;margin:0}.sub{color:#555;margin:4px 0 16px}
h2{font-size:14px;border-bottom:1px solid #999;padding-bottom:4px;margin-top:20px}
table{width:100%;border-collapse:collapse;margin-top:8px}
th,td{border:1px solid #bbb;padding:5px 7px;text-align:left;vertical-align:top}
th{background:#eee}.meta{color:#555;font-size:11px;margin-top:16px}ol{margin:8px 0;padding-left:20px}li{margin-bottom:4px}
</style></head><body>
<h1>HydraNexus — Incident Report</h1>
<p class="sub">Generated ${esc(new Date().toLocaleString())} · Scenario: ${esc(scenario)} · Source: ${live ? 'live AI backend' : 'local feed (backend unreachable)'} · Demo data — simulated telemetry, no live sensors.</p>
<h2>1. Incident snapshot</h2>
<table><tr><th>Field</th><th>Value</th></tr>
<tr><td>Status</td><td>Investigating</td></tr>
<tr><td>Primary hypothesis</td><td>${esc(hyp)}</td></tr>
<tr><td>Severity</td><td>${esc(sev)}</td></tr>
<tr><td>Confidence</td><td>${esc(conf)}${conf === '—' ? '' : '%'}</td></tr>
<tr><td>Probable location</td><td>${esc(seg)} · ${esc(zone)} (${esc(locConf)}${locConf === '—' ? '' : '%'} confidence)</td></tr>
<tr><td>GIS Coordinates</td><td>${esc(locGisText)}</td></tr>
<tr><td>ML anomaly score</td><td>${esc(score)}</td></tr>
<tr><td>Pipe condition</td><td>${esc(pipe)}</td></tr>
<tr><td>Temporal score</td><td>${esc(tScore)}</td></tr></table>
<h2>2. Latest telemetry (${esc(last.time ?? '—')})</h2>
<table><tr><th>Signal</th><th>Reading</th><th>Deviation vs baseline</th></tr>
<tr><td>Flow</td><td>${last.flow != null ? `${fmt(last.flow)} L/hr` : '—'}</td><td>${esc(devTxt('flow', ''))}</td></tr>
<tr><td>Pressure</td><td>${last.pressure != null ? `${Number(last.pressure).toFixed(2)} bar` : '—'}</td><td>${esc(devTxt('pressure', ''))}</td></tr>
<tr><td>Consumption</td><td>${last.consumption != null ? `${fmt(last.consumption)} L/hr` : '—'}</td><td>${esc(devTxt('consumption', ''))}</td></tr>
<tr><td>Tank level</td><td>${last.level != null ? `${Number(last.level).toFixed(2)} m` : '—'}</td><td>${esc(devTxt('level', ''))}</td></tr>
<tr><td>Eddy-current variance</td><td>${last.eddy_current_variance != null ? Number(last.eddy_current_variance).toFixed(3) : '—'}</td><td>0 healthy · 1 crack</td></tr></table>
<h2>3. Ranked causes</h2>
<table><tr><th>Cause</th><th>Score</th></tr>${causeRows}</table>
<h2>4. Evidence</h2><ol>${evidenceItems}</ol>
<h2>5. Scenario verification</h2>${verifySection}
${simRows ? `<h2>6. Observed vs simulated flow</h2><table><tr><th>Time</th><th>Observed (L/hr)</th><th>Simulated (L/hr)</th></tr>${simRows}</table>` : ''}
<h2>${simRows ? '7' : '6'}. Impact</h2>
<table><tr><th>Field</th><th>Value</th></tr>
<tr><td>Estimated loss</td><td>${impact.lossPerHour != null ? `${fmt(Math.round(impact.lossPerHour))} L/hr` : '—'}</td></tr>
<tr><td>24-hour projection</td><td>${impact.loss24h != null ? `${fmt(Math.round(impact.loss24h))} L` : '—'}</td></tr>
<tr><td>Affected zone / users</td><td>${esc(impact.affectedZone ?? zone)} / ${impact.affectedUsers != null ? fmt(impact.affectedUsers) : '—'}</td></tr></table>
<p>${esc(ai?.operatorNote ?? 'Advisory output only.')}</p>
<p class="meta">HydraNexus MVP · Decision support only — a qualified operator reviews evidence and remains accountable for any intervention. Do not connect this demo to live control hardware.</p>
</body></html>`
    const win = window.open('', '_blank', 'width=960,height=720')
    if (!win) {
      setToast({ message: 'Popup blocked — allow popups to export PDF.', type: 'danger' })
      return
    }
    win.document.write(html)
    win.document.close()
    win.focus()
    setTimeout(() => win.print(), 350)
    setToast({ message: 'Report ready — choose Save as PDF in the print dialog.', type: 'success' })
  }

  const meta =
    page === 'monitoring' && dataSourceMode === 'real'
      ? ['Real SCADA Dataset', 'BattLeDIM 2018 benchmark · 2,176 km network · 442 sensors · Ground-truth leak events']
      : pageMeta[page]

  const render = () => {
    if (page === 'overview')
      return (
        <Overview
          active={active}
          data={data}
          scenario={scenario}
          setPage={setPage}
          trigger={trigger}
          onExport={exportReport}
          onOpenRealData={() => {
            setDataSourceMode('real')
            setPage('monitoring')
          }}
          onViewMap={handleOpenMap}
        />
      )
    if (page === 'network') return <NetworkPage active={active} scenario={scenario} onViewMap={handleOpenMap} />
    if (page === 'monitoring')
      return (
        <MonitoringPage
          scenario={scenario}
          setScenario={handleScenarioChange}
          mode={dataSourceMode}
          setMode={setDataSourceMode}
        />
      )
    if (page === 'incident')
      return (
        <InvestigationPage
          active={active}
          verify={doVerify}
          verified={verified}
          verifyResult={verifyResult}
          onExport={exportReport}
          onExportPDF={exportPDF}
          data={data}
          scenario={scenario}
          setScenario={handleScenarioChange}
          setPage={setPage}
          onViewMap={handleOpenMap}
        />
      )
    if (page === 'impact') return <ImpactPage active={active} data={data} scenario={scenario} />
    if (page === 'whatif') return <WhatIfPage active={active} data={data} scenario={scenario} />
    if (page === 'history') return <HistoryPage setPage={setPage} />
    if (page === 'privacy') return <PrivacyPage />
    if (page === 'terms') return <TermsPage />
    return <SettingsPage />
  }

  return (
    <div className="relative min-h-screen bg-background text-foreground selection:bg-cyan-500/30">
      {showLanding && (
        <LandingExperience
          onComplete={handleLandingComplete}
          scenario={scenario}
        />
      )}
      <AmbientNetwork incidentActive={active} scenario={scenario} />
      <Toast toast={toast} onClose={() => setToast(null)} />
      <FaultMapModal
        isOpen={mapModalOpen}
        onClose={() => setMapModalOpen(false)}
        location={selectedMapLocation}
        incidentActive={active}
      />
      <div className="relative z-10 lg:flex">
        <Sidebar
          page={page}
          setPage={setPage}
          mobileOpen={mobileOpen}
          onClose={() => setMobileOpen(false)}
          incidentActive={active}
          onReplayBriefing={handleReplayBriefing}
          dataSourceMode={dataSourceMode}
          setDataSourceMode={setDataSourceMode}
        />
        <div className="min-w-0 flex-1">
          <PageHeader
            title={meta[0]}
            subtitle={meta[1]}
            onMenu={() => setMobileOpen(true)}
            onTrigger={trigger}
            incidentActive={active}
            backendOnline={backendOnline}
            scenario={scenario}
            onScenarioChange={handleScenarioChange}
            onReplayBriefing={handleReplayBriefing}
            dataSourceMode={dataSourceMode}
            onDataSourceModeChange={handleDataSourceModeChange}
          />
          <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
            <PageTransition pageKey={page}>
              {render()}
            </PageTransition>
            <footer className="flex flex-col items-center justify-between gap-2 border-t border-slate-800/80 pt-4 text-xs text-slate-500 sm:flex-row">
              <p>HydraNexus MVP · Demo data — simulated telemetry, no live sensors · Human-in-the-loop</p>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" onClick={() => setPage('privacy')}>
                  Privacy Policy
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setPage('terms')}>
                  Terms
                </Button>
              </div>
            </footer>
          </main>
        </div>
      </div>
    </div>
  )
}
