/**
 * RealInvestigationPage — R1: root-cause investigation for the REAL BattLeDIM
 * 2018 SCADA data. Mirrors the demo Investigation page's role but is native to
 * the real dataset: per-sensor pressure-z ranking, inflow decomposition per
 * meter, hour-of-day context, alarm timeline and supply-branch attribution.
 *
 * Analysis is SCADA-only (the backend never reads leak labels); the answer key
 * is not shown here at all — this page is purely "what can we deduce from
 * flow + pressure".
 */
import { useEffect, useMemo, useState } from 'react'
import { Microscope, RefreshCw, AlertTriangle, Clock, GitBranch, Gauge } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from './ui/card'
import { Badge } from './ui/badge'
import LTownMap from './LTownMap'
import { fetchRealDataMetadata, fetchRealDataTelemetry, postRealDataInvestigate } from '../api'

// Session cache so re-entering the page doesn't refetch metadata.
let metaCache = null

function zTone(z) {
  if (z == null) return 'text-slate-400'
  if (z <= -3.0) return 'text-rose-400 font-semibold'
  if (z <= -1.5) return 'text-amber-400 font-semibold'
  if (z >= 3.0) return 'text-cyan-300'
  return 'text-slate-300'
}

export default function RealInvestigationPage() {
  const [events, setEvents] = useState([])
  const [pipe, setPipe] = useState('p232')
  const [points, setPoints] = useState(24)
  const [telemetry, setTelemetry] = useState(null)
  const [inv, setInv] = useState(null)
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

  // Fetch the window, then run the investigation pipeline on it.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchRealDataTelemetry({ event_pipe: pipe || undefined, points })
      .then((res) => {
        if (cancelled) return
        setTelemetry(res)
        return postRealDataInvestigate(res.telemetry || [])
      })
      .then((r) => {
        if (!cancelled) {
          setInv(r || null)
          setLoading(false)
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e?.message || 'Investigation request failed')
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [pipe, points])

  const sag = useMemo(() => inv?.sag_sensors || [], [inv])
  const topSensor = inv?.sensor_ranking?.[0] || null

  return (
    <div className="space-y-4">
      {/* Provenance + controls */}
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
          <Microscope className="h-3 w-3" /> BATTLEDIM 2018 REAL · SCADA-only analysis
        </Badge>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-700/40 bg-amber-950/20 p-4 text-xs text-amber-200">
          <AlertTriangle className="h-4 w-4" /> {error} — the backend may be cold-starting; try again shortly.
        </div>
      )}

      {!inv && !error && (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center text-xs text-slate-400">
          <RefreshCw className="h-5 w-5 animate-spin text-cyan-500" />
          Running the investigation pipeline over the window…
        </div>
      )}

      {inv && (
        <>
          {/* Headline read */}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-rose-500/20 bg-rose-950/20 p-4">
              <p className="text-[10px] font-mono uppercase tracking-wider text-slate-400">Strongest reacting sensor</p>
              <p className="mt-1 text-2xl font-bold text-rose-300">{topSensor?.sensor || '—'}</p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                pressure z {topSensor?.min_z != null ? `${topSensor.min_z}` : '—'} at {topSensor?.worst_at?.slice(11, 16) || '—'}
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-[#0c1626]/85 p-4">
              <p className="text-[10px] font-mono uppercase tracking-wider text-slate-400">Sagging sensors (z ≤ −1.5)</p>
              <p className="mt-1 text-2xl font-bold text-slate-200">{inv.attribution?.sag_sensor_count ?? '—'}</p>
              <p className="mt-0.5 text-[11px] text-slate-500">of 33 network pressure sensors</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-[#0c1626]/85 p-4">
              <p className="text-[10px] font-mono uppercase tracking-wider text-slate-400">Hour-of-day context</p>
              <p className="mt-1 text-2xl font-bold text-slate-200">
                {inv.hour_context?.latest_flow ?? '—'} <span className="text-xs font-normal text-slate-400">m³/h</span>
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                typical {inv.hour_context?.typical ?? '—'} ·{' '}
                {inv.hour_context?.within_band ? (
                  <span className="text-emerald-400">inside normal band</span>
                ) : (
                  <span className="text-amber-400">outside normal band</span>
                )}
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-[#0c1626]/85 p-4">
              <p className="text-[10px] font-mono uppercase tracking-wider text-slate-400">First sustained alarm</p>
              <p className="mt-1 text-2xl font-bold text-slate-200">{inv.alarm_timeline?.first_sustained?.slice(11, 16) || '—'}</p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {inv.alarm_timeline?.first_sustained?.slice(0, 10) || 'no sustained alarm in this window'} ·{' '}
                {inv.alarm_timeline?.alarm_step_count ?? 0} alarm steps
              </p>
            </div>
          </div>

          {/* Evidence summary */}
          <Card className="border-slate-800/80 bg-[#0c1626]/85 backdrop-blur-sm">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-slate-200">
                <Microscope className="h-4 w-4 text-cyan-400" /> Root-cause evidence
              </CardTitle>
              <CardDescription className="text-[11px]">
                What the SCADA signals say about this window — the leak answer key is never an input.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1.5 text-xs leading-relaxed text-slate-300">
                {(inv.evidence || []).map((line, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-cyan-500" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            {/* Sensor ranking */}
            <Card className="border-slate-800/80 bg-[#0c1626]/85 backdrop-blur-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-slate-200">Pressure-sensor reaction ranking</CardTitle>
                <CardDescription className="text-[11px]">
                  Each sensor&apos;s strongest deviation (robust z) from its own hour-of-day baseline over the window.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-[10px] font-mono uppercase tracking-wider text-slate-500">
                        <th className="py-2 pr-3">#</th>
                        <th className="py-2 pr-3">Sensor</th>
                        <th className="py-2 pr-3">Min z</th>
                        <th className="py-2 pr-3">Worst at</th>
                        <th className="py-2 pr-3">Sag steps</th>
                        <th className="py-2">Branch</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono">
                      {(inv.sensor_ranking || []).slice(0, 10).map((r) => (
                        <tr key={r.sensor} className="border-b border-slate-900/70 hover:bg-slate-900/40">
                          <td className="py-2 pr-3 text-slate-500">{r.rank}</td>
                          <td className="py-2 pr-3 font-semibold text-slate-200">{r.sensor}</td>
                          <td className={`py-2 pr-3 ${zTone(r.min_z)}`}>{r.min_z}</td>
                          <td className="py-2 pr-3 text-slate-400">{r.worst_at?.slice(11, 16) || '—'}</td>
                          <td className="py-2 pr-3 text-slate-400">{r.sag_steps}</td>
                          <td className="py-2 text-[10px] text-slate-400">{r.branch || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-4">
              {/* Meter decomposition */}
              <Card className="border-slate-800/80 bg-[#0c1626]/85 backdrop-blur-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm font-medium text-slate-200">
                    <Gauge className="h-4 w-4 text-cyan-400" /> Inflow decomposition — who caused it?
                  </CardTitle>
                  <CardDescription className="text-[11px]">
                    Latest reading vs the typical level for this hour, per district meter.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-2 sm:grid-cols-3">
                  {(inv.meter_decomposition || []).map((m) => (
                    <div key={m.meter} className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
                      <p className="font-mono text-[11px] font-semibold text-cyan-300">{m.meter}</p>
                      <p className="mt-1 text-lg font-bold text-slate-200">
                        {m.latest != null ? m.latest.toFixed(1) : '—'}
                        <span className="ml-1 text-[10px] font-normal text-slate-500">m³/h</span>
                      </p>
                      <p className="text-[10px] text-slate-500">typical {m.typical_for_hour != null ? m.typical_for_hour.toFixed(1) : '—'}</p>
                      <p className={`text-[11px] font-mono ${(m.excess || 0) > 0.5 ? 'text-rose-400' : 'text-emerald-400'}`}>
                        {(m.excess || 0) > 0.5 ? `+${m.excess.toFixed(1)} excess` : 'no excess'}
                      </p>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* Branch attribution */}
              <Card className="border-slate-800/80 bg-[#0c1626]/85 backdrop-blur-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm font-medium text-slate-200">
                    <GitBranch className="h-4 w-4 text-amber-400" /> Where is it? — supply-branch attribution
                  </CardTitle>
                  <CardDescription className="text-[11px]">{inv.attribution?.note}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {(inv.attribution?.branches || []).length === 0 && (
                    <p className="text-xs text-slate-500">No branch attribution — no sagging sensors in this window.</p>
                  )}
                  {(inv.attribution?.branches || []).map((b) => (
                    <div key={b.branch} className="rounded-lg border border-slate-800 bg-slate-900/50 p-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-200">{b.label}</span>
                        <span className="font-mono text-[10px] text-slate-400">{b.count} sensor{b.count === 1 ? '' : 's'}</span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {b.sensors.map((s) => (
                          <span key={s} className="rounded border border-amber-500/30 bg-amber-950/40 px-1.5 py-0.5 font-mono text-[10px] text-amber-300">
                            {s}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                  {inv.attribution?.nearest_pipe_to_cluster_centroid && (
                    <p className="font-mono text-[10px] text-slate-500">
                      Closest pipe to the sag-cluster centroid: {inv.attribution.nearest_pipe_to_cluster_centroid.pipe} (±
                      {inv.attribution.nearest_pipe_to_cluster_centroid.dist_model_m} model-m)
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Map: sagging sensors highlighted */}
          <Card className="border-slate-800/80 bg-[#0c1626]/85 backdrop-blur-sm">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-slate-200">
                <Clock className="h-4 w-4 text-slate-400" /> Where the pressure sagged — real L-Town GIS
              </CardTitle>
              <CardDescription className="text-[11px]">
                <span className="text-amber-400">Amber sensors</span> dropped below their hour-of-day baseline (z ≤ −1.5)
                in this window. A tight amber cluster points at the neighborhood where water was leaving the network.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[380px] w-full">
                <LTownMap sensors={sag} focus={topSensor?.sensor || null} reactedSensor={topSensor?.sensor || null} />
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
