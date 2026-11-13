/**
 * RealImpactPage — R2: decision-support impact estimate for the REAL BattLeDIM
 * 2018 SCADA data. Estimated loss comes from excess inflow above the
 * hour-of-day typical level (SCADA-only); the published answer key is shown
 * ONLY in a clearly-labelled overlay so the estimate can be judged against it.
 */
import { useEffect, useMemo, useState } from 'react'
import { Droplets, AlertTriangle, MapPin, RefreshCw } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from './ui/card'
import { Badge } from './ui/badge'
import LTownMap from './LTownMap'
import { fetchRealDataMetadata, fetchRealDataTelemetry, postRealDataImpact } from '../api'

let metaCache = null

function severityBadge(sev) {
  if (sev === 'HIGH')
    return <Badge className="border-rose-700/60 bg-rose-950/50 text-rose-400 hover:bg-rose-950/50">HIGH impact</Badge>
  if (sev === 'MEDIUM')
    return <Badge className="border-amber-700/60 bg-amber-950/50 text-amber-400 hover:bg-amber-950/50">MEDIUM impact</Badge>
  if (sev === 'LOW')
    return <Badge className="border-cyan-700/60 bg-cyan-950/50 text-cyan-400 hover:bg-cyan-950/50">LOW impact</Badge>
  return <Badge className="border-slate-700/60 bg-slate-900/60 text-slate-400 hover:bg-slate-900/60">No measurable impact</Badge>
}

function LossTile({ label, value, unit, hint, tone = 'slate' }) {
  const tones = {
    rose: 'border-rose-500/25 bg-rose-950/20 text-rose-300',
    amber: 'border-amber-500/25 bg-amber-950/20 text-amber-300',
    cyan: 'border-cyan-500/25 bg-cyan-950/20 text-cyan-300',
    slate: 'border-slate-800 bg-[#0c1626]/85 text-slate-200',
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

export default function RealImpactPage() {
  const [events, setEvents] = useState([])
  const [pipe, setPipe] = useState('p232')
  const [points, setPoints] = useState(24)
  const [imp, setImp] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (metaCache) {
      setEvents(metaCache)
      return
    }
    fetchRealDataMetadata()
      .then((m) => {
        metaCache = m?.leakage_events || []
        setEvents(metaCache)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchRealDataTelemetry({ event_pipe: pipe || undefined, points })
      .then((res) => postRealDataImpact(res.telemetry || []))
      .then((r) => {
        if (!cancelled) {
          setImp(r || null)
          setLoading(false)
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e?.message || 'Impact request failed')
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [pipe, points])

  const loss = imp?.estimated_loss || {}
  const area = imp?.affected_area || {}
  const key = imp?.answer_key_overlay || {}
  const sag = useMemo(() => area.sag_sensors || [], [area])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={pipe}
            onChange={(e) => setPipe(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-2 text-xs font-mono"
          >
            <option value="">Baseline (No Active Leaks)</option>
            {events.map((ev) => (
              <option key={ev.pipe} value={ev.pipe}>
                Pipe {ev.pipe} ({ev.start_time?.slice(0, 10)} · {ev.max_rate} m³/h)
              </option>
            ))}
          </select>
          <select
            value={points}
            onChange={(e) => setPoints(Number(e.target.value))}
            className="h-9 rounded-md border border-input bg-background px-2 text-xs font-mono"
          >
            <option value={16}>16 pts</option>
            <option value={24}>24 pts</option>
            <option value={48}>48 pts</option>
            <option value={96}>96 pts</option>
          </select>
        </div>
        <Badge className="gap-1 border-emerald-700/60 bg-emerald-950/50 text-emerald-400 hover:bg-emerald-950/50">
          <Droplets className="h-3 w-3" /> BATTLEDIM 2018 REAL · SCADA-only estimate
        </Badge>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-700/40 bg-amber-950/20 p-4 text-xs text-amber-200">
          <AlertTriangle className="h-4 w-4" /> {error} — the backend may be cold-starting; try again shortly.
        </div>
      )}

      {!imp && !error && (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center text-xs text-slate-400">
          <RefreshCw className="h-5 w-5 animate-spin text-cyan-500" />
          Estimating impact from the SCADA window…
        </div>
      )}

      {imp && (
        <>
          <div className="flex items-center justify-between rounded-xl border border-slate-800/80 bg-[#0c1626]/60 px-4 py-3">
            <p className="text-xs text-slate-400">
              Window {imp.window?.start} → {imp.window?.end} · 5-min native interval ·{' '}
              <span className="text-slate-300">{loss.method}</span>
            </p>
            {severityBadge(imp.severity)}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <LossTile
              label="Latest loss rate (est.)"
              value={(loss.latest_lph ?? 0).toLocaleString()}
              unit="L/hr"
              hint={`${loss.latest_m3h ?? 0} m³/h above hour-typical inflow`}
              tone={(loss.latest_m3h ?? 0) > 0.5 ? 'rose' : 'slate'}
            />
            <LossTile
              label="Peak loss rate (est.)"
              value={(loss.peak_lph ?? 0).toLocaleString()}
              unit="L/hr"
              hint={`window peak · ${loss.peak_m3h ?? 0} m³/h`}
              tone={(loss.peak_m3h ?? 0) > 4 ? 'rose' : 'slate'}
            />
            <LossTile
              label="Cumulative excess volume"
              value={(loss.cumulative_volume_m3 ?? 0).toLocaleString()}
              unit="m³"
              hint="∫ (inflow − hour-typical) over the window"
              tone="amber"
            />
            <LossTile
              label="Elevated duration"
              value={loss.elevated_minutes ?? 0}
              unit="min"
              hint="time with inflow > 0.5 m³/h above typical"
              tone="cyan"
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            {/* Affected area */}
            <Card className="border-slate-800/80 bg-[#0c1626]/85 backdrop-blur-sm">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-medium text-slate-200">
                  <MapPin className="h-4 w-4 text-amber-400" /> Affected area — where the network felt it
                </CardTitle>
                <CardDescription className="text-[11px]">
                  Sensors whose pressure fell below their hour-of-day baseline (z ≤ −1.5), grouped by the supply branch
                  that feeds them.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2.5">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-slate-400">Sagging sensors:</span>
                  {sag.length === 0 && <span className="text-slate-500">none in this window</span>}
                  {sag.map((s) => (
                    <span key={s} className="rounded border border-amber-500/30 bg-amber-950/40 px-1.5 py-0.5 font-mono text-[10px] text-amber-300">
                      {s}
                    </span>
                  ))}
                </div>
                {area.primary_branch_label && (
                  <p className="text-xs text-slate-300">
                    Primary affected supply branch: <span className="font-semibold text-amber-300">{area.primary_branch_label}</span>
                  </p>
                )}
                {area.nearest_pipe_to_cluster_centroid && (
                  <p className="font-mono text-[10px] text-slate-500">
                    Closest pipe to the sag-cluster centroid: {area.nearest_pipe_to_cluster_centroid.pipe} (±
                    {area.nearest_pipe_to_cluster_centroid.dist_model_m} model-m)
                  </p>
                )}
                <div className="h-[300px] w-full">
                  <LTownMap sensors={sag} focus={sag[0] || null} />
                </div>
              </CardContent>
            </Card>

            {/* Answer-key overlay */}
            <Card className="border-amber-800/40 bg-amber-950/10 backdrop-blur-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-amber-200">Ground-truth overlay (answer key)</CardTitle>
                <CardDescription className="text-[11px] text-amber-100/70">{key.note}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2.5 text-xs">
                <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
                  <div className="rounded-lg border border-amber-800/40 bg-amber-950/20 p-2.5">
                    <p className="text-[9px] uppercase tracking-wider text-slate-500">Actual leak now</p>
                    <p className="mt-0.5 text-sm text-amber-200">{key.actual_loss_latest_m3h ?? 0} m³/h</p>
                  </div>
                  <div className="rounded-lg border border-amber-800/40 bg-amber-950/20 p-2.5">
                    <p className="text-[9px] uppercase tracking-wider text-slate-500">Actual volume in window</p>
                    <p className="mt-0.5 text-sm text-amber-200">{key.actual_volume_window_m3 ?? 0} m³</p>
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-wider text-slate-500">Active leak pipes (answer key)</p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {(key.active_leaks_now || []).length === 0 && (
                      <span className="text-slate-500">no physical leakage in this window</span>
                    )}
                    {(key.active_leaks_now || []).map((p) => (
                      <span key={p} className="rounded border border-rose-500/30 bg-rose-950/40 px-1.5 py-0.5 font-mono text-[10px] text-rose-300">
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
                <p className="rounded-lg border border-slate-800 bg-slate-900/50 p-2.5 text-[11px] leading-relaxed text-slate-400">
                  <span className="font-semibold text-slate-300">How to read this:</span> our SCADA-only estimate
                  ({loss.peak_m3h ?? 0} m³/h peak, {loss.cumulative_volume_m3 ?? 0} m³ total) vs the answer key&apos;s
                  actual loss ({key.actual_loss_latest_m3h ?? 0} m³/h now, {key.actual_volume_window_m3 ?? 0} m³ in
                  window). Agreement here shows the excess-inflow method tracks reality without ever reading the labels.
                </p>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
