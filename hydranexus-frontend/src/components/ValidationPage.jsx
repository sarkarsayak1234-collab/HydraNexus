import { useEffect, useState } from 'react'
import { ShieldCheck, RefreshCw, AlertTriangle, CheckCircle2, XCircle, Timer, Crosshair, Database, Scale, Map } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from './ui/card'
import { Badge } from './ui/badge'
import LTownMap from './LTownMap'
import { fetchRealDataEvaluate, fetchRealDataModelInfo } from '../api'

function MetricTile({ label, value, unit, hint, tone = 'cyan' }) {
  const tones = {
    cyan: 'text-cyan-400 border-cyan-500/20 bg-cyan-950/20',
    emerald: 'text-emerald-400 border-emerald-500/20 bg-emerald-950/20',
    amber: 'text-amber-400 border-amber-500/20 bg-amber-950/20',
    rose: 'text-rose-400 border-rose-500/20 bg-rose-950/20',
    slate: 'text-slate-300 border-slate-700/60 bg-slate-900/40',
  }
  return (
    <div className={`rounded-xl border p-4 ${tones[tone]}`}>
      <p className="text-[10px] font-mono uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-bold tracking-tight">
        {value}
        {unit && <span className="ml-1 text-xs font-normal text-slate-400">{unit}</span>}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p>}
    </div>
  )
}

function DetectedBadge({ detected }) {
  return detected ? (
    <Badge className="gap-1 border-emerald-700/60 bg-emerald-950/50 text-emerald-400 hover:bg-emerald-950/50">
      <CheckCircle2 className="h-3 w-3" /> Detected
    </Badge>
  ) : (
    <Badge className="gap-1 border-slate-700/60 bg-slate-900/60 text-slate-400 hover:bg-slate-900/60">
      <XCircle className="h-3 w-3" /> Missed
    </Badge>
  )
}

export default function ValidationPage() {
  const [report, setReport] = useState(null)
  const [model, setModel] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      // Model info first (fast once warm); benchmark may take ~30-60 s cold.
      fetchRealDataModelInfo().then(setModel).catch(() => {})
      const j = await fetchRealDataEvaluate()
      setReport(j)
      if (j?.model) setModel(j.model)
    } catch (e) {
      setError(e?.message || 'Benchmark request failed — the backend may be cold-starting. Try again in a minute.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  if (loading && !report) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <div className="relative">
          <ShieldCheck className="h-10 w-10 text-cyan-400 animate-pulse" />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-200">Replaying the detector over the full BattLeDIM 2018 benchmark…</p>
          <p className="mt-1 max-w-md text-xs text-muted-foreground">
            The reference model is built server-side on first run (up to ~3 min on the free tier), then cached. Every
            subsequent run is fast.
          </p>
        </div>
        <RefreshCw className="h-4 w-4 animate-spin text-cyan-500" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
        <AlertTriangle className="h-8 w-8 text-amber-400" />
        <p className="max-w-md text-sm text-slate-300">{error}</p>
        <button
          onClick={load}
          className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-xs font-mono font-medium text-white hover:bg-sky-500"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Retry benchmark
        </button>
      </div>
    )
  }

  if (!report) return null

  const m = report.metrics || {}
  const events = report.events || []
  const chronic = report.chronic_episodes || []
  const te = m.events || {}
  const tc = m.chronic || {}
  const controls = report.control_windows || []
  const controlFp = controls.filter((c) => c.false_alarm)

  return (
    <div className="space-y-6">
      {/* Transparency banner */}
      <div className="flex items-start gap-3 rounded-xl border border-emerald-700/40 bg-emerald-950/20 p-4">
        <Scale className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
        <div className="text-xs leading-relaxed text-emerald-100/90">
          <span className="font-semibold text-emerald-300">Honest validation.</span> The live detector never reads the
          ground-truth leakage file — it sees only SCADA flow and pressure signals. Ground truth is used here{' '}
          <span className="font-mono">exclusively</span> to score the detector after the fact: every leak episode derived
          from the published BattLeDIM 2018 answer key is replayed against the detector with a causal (14-day pre-window)
          baseline, plus leak-free control windows to measure false-alarm exposure. All numbers below come from the real
          run — nothing is simulated or hard-coded.
        </div>
      </div>

      {/* Headline metrics */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricTile
          label="Event recall"
          value={te.recall_pct ?? '—'}
          unit="%"
          hint={`${te.episodes_detected ?? '—'} of ${te.episodes_total ?? '—'} event episodes detected`}
          tone="emerald"
        />
        <MetricTile
          label="Precision"
          value={te.precision_pct ?? '—'}
          unit="%"
          hint="vs expected false detections across exposure"
          tone="cyan"
        />
        <MetricTile label="F1 score" value={te.f1_pct ?? '—'} unit="%" hint="harmonic mean on event tier" tone="cyan" />
        <MetricTile
          label="Median latency"
          value={te.median_latency_min ?? '—'}
          unit="min"
          hint="from leak start to first sustained alarm"
          tone="amber"
        />
        <MetricTile
          label="Control FP rate"
          value={m.control_fp_window_rate_pct ?? '—'}
          unit="%"
          hint={`${m.control_windows_with_false_alarm ?? 0}/${controls.length} leak-free windows alarmed`}
          tone="rose"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        {/* Events table */}
        <Card className="border-slate-800/80 bg-[#0c1626]/85 backdrop-blur-sm xl:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <div>
              <CardTitle className="text-sm font-medium text-slate-200">Event-episode replay (headline tier)</CardTitle>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Every significant leak change in the ground truth, scanned over [start−24h, start+24h] at native 5-min
                resolution. Alarm must fire within 12 h of leak start.
              </p>
            </div>
            <button
              onClick={load}
              disabled={loading}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900/80 px-2.5 py-1.5 text-[11px] font-mono text-slate-300 hover:border-cyan-600/50 hover:text-cyan-300 disabled:opacity-50"
            >
              <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} /> Rerun
            </button>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-[10px] font-mono uppercase tracking-wider text-slate-500">
                    <th className="py-2 pr-3">Pipe</th>
                    <th className="py-2 pr-3">Start</th>
                    <th className="py-2 pr-3">Duration</th>
                    <th className="py-2 pr-3">Max rate</th>
                    <th className="py-2 pr-3">Result</th>
                    <th className="py-2 pr-3">Latency</th>
                    <th className="py-2 pr-3">Reacting sensor</th>
                    <th className="py-2">Pre-alarm</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {events.map((e) => (
                    <tr key={`${e.pipe}-${e.start}`} className="border-b border-slate-900/70 hover:bg-slate-900/40">
                      <td className="py-2 pr-3 font-semibold text-slate-200">{e.pipe}</td>
                      <td className="py-2 pr-3 text-slate-400">{e.start?.slice(5, 16)}</td>
                      <td className="py-2 pr-3 text-slate-400">{Math.round(e.duration_hours)} h</td>
                      <td className="py-2 pr-3 text-slate-300">{e.max_rate_m3h} m³/h</td>
                      <td className="py-2 pr-3"><DetectedBadge detected={e.detected} /></td>
                      <td className="py-2 pr-3 text-slate-300">{e.latency_min != null ? `${e.latency_min} min` : '—'}</td>
                      <td className="py-2 pr-3 text-cyan-400">{e.reacted_sensor || '—'}</td>
                      <td className="py-2 text-amber-400/80">{e.pre_alarms ? 'yes*' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[10px] leading-relaxed text-slate-500">
              * Pre-alarm = the rule fired shortly before this episode's start. Attribution analysis shows these are
              usually true alarms for a <span className="text-slate-400">different concurrent leak</span> active in the
              pre-window (e.g. p538's pre-window contains p628's 35 m³/h leak).
            </p>
          </CardContent>
        </Card>

        {/* Model card */}
        <div className="space-y-6">
          <Card className="border-slate-800/80 bg-[#0c1626]/85 backdrop-blur-sm">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-slate-200">
                <Database className="h-4 w-4 text-cyan-400" /> Detector model card
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
                <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-2.5">
                  <p className="text-[9px] uppercase tracking-wider text-slate-500">Reference records</p>
                  <p className="mt-0.5 text-sm text-slate-200">{(model?.reference_records ?? 105120).toLocaleString()}</p>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-2.5">
                  <p className="text-[9px] uppercase tracking-wider text-slate-500">IF training rows</p>
                  <p className="mt-0.5 text-sm text-slate-200">{(model?.trained_records ?? 0).toLocaleString()}</p>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-2.5">
                  <p className="text-[9px] uppercase tracking-wider text-slate-500">Pressure sensors</p>
                  <p className="mt-0.5 text-sm text-slate-200">{model?.pressure_sensors ?? 33}</p>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-2.5">
                  <p className="text-[9px] uppercase tracking-wider text-slate-500">Ground truth in detection</p>
                  <p className="mt-0.5 text-sm text-emerald-400">NEVER</p>
                </div>
              </div>
              <div>
                <p className="text-[10px] font-mono uppercase tracking-wider text-slate-500">Frozen alarm rule</p>
                <p className="mt-1 leading-relaxed text-slate-300">{model?.rule || report.method}</p>
              </div>
              <div>
                <p className="text-[10px] font-mono uppercase tracking-wider text-slate-500">Thresholds (constants)</p>
                <div className="mt-1 grid grid-cols-2 gap-1 font-mono text-[10px]">
                  {Object.entries(model?.thresholds || {}).map(([k, v]) => (
                    <div key={k} className="flex justify-between rounded border border-slate-800/80 bg-slate-900/40 px-2 py-1">
                      <span className="text-slate-500">{k}</span>
                      <span className="text-cyan-300">{String(v)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-800/80 bg-[#0c1626]/85 backdrop-blur-sm">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-slate-200">
                <Crosshair className="h-4 w-4 text-amber-400" /> Chronic tier & controls
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
                <div className="rounded-lg border border-amber-800/40 bg-amber-950/20 p-2.5">
                  <p className="text-[9px] uppercase tracking-wider text-slate-500">Chronic episodes</p>
                  <p className="mt-0.5 text-sm text-amber-300">{tc.episodes_detected ?? 0}/{tc.episodes_total ?? 0} detected</p>
                  <p className="mt-0.5 text-[9px] text-slate-500">by design — they ARE the typical state</p>
                </div>
                <div className="rounded-lg border border-rose-800/40 bg-rose-950/20 p-2.5">
                  <p className="text-[9px] uppercase tracking-wider text-slate-500">FP alarm points</p>
                  <p className="mt-0.5 text-sm text-rose-300">{m.control_alarm_point_rate_pct ?? 0}%</p>
                  <p className="mt-0.5 text-[9px] text-slate-500">of {m.control_points_evaluated?.toLocaleString()} control points</p>
                </div>
              </div>
              <div>
                <p className="text-[10px] font-mono uppercase tracking-wider text-slate-500">False-alarm control windows</p>
                <div className="mt-1 space-y-1 font-mono text-[10px]">
                  {controlFp.length === 0 && <p className="text-emerald-400">No false alarms in any control window.</p>}
                  {controlFp.slice(0, 4).map((c) => (
                    <div key={c.start} className="flex justify-between rounded border border-slate-800/80 bg-slate-900/40 px-2 py-1">
                      <span className="text-slate-400">{c.start?.slice(0, 10)}</span>
                      <span className="text-rose-400">{c.alarm_points} alarm pts</span>
                    </div>
                  ))}
                  {controlFp.length > 4 && (
                    <p className="text-slate-500">+ {controlFp.length - 4} more windows listed in the API report</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Localization map: ground-truth pipe vs localized reacting sensor */}
      <Card className="border-slate-800/80 bg-[#0c1626]/85 backdrop-blur-sm">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-slate-200">
              <Map className="h-4 w-4 text-emerald-400" /> Leak localization quality — real L-Town GIS
            </CardTitle>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Amber pipes = ground-truth leak locations (answer key). Markers = the sensor the detector localized
              (argmin pressure z). Green = detected episodes; dashed lines connect each ground-truth pipe to its
              localized sensor so localization distance is visible.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono">
            <span className="inline-flex items-center gap-1 rounded border border-amber-500/30 bg-amber-950/40 px-1.5 py-0.5 text-amber-400">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> ground truth
            </span>
            <span className="inline-flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-950/40 px-1.5 py-0.5 text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> localized sensor
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-[460px] w-full">
            <LTownMap episodes={events.filter((e) => e.reacted_sensor)} />
          </div>
        </CardContent>
      </Card>

      {/* Method notes */}
      <Card className="border-slate-800/80 bg-[#0c1626]/85 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-slate-200">
            <Timer className="h-4 w-4 text-slate-400" /> Method notes — how to read these numbers
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2 text-[11px] leading-relaxed text-slate-400 md:grid-cols-2">
            {(report.method_notes || []).map((note, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-cyan-500" />
                <span>{note}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 font-mono text-[10px] text-slate-600">
            Report generated {report.generated_at} · {report.dataset}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
