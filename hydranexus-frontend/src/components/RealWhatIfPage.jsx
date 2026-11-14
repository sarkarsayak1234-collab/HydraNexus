/**
 * RealWhatIfPage — R3a: the response planner for the REAL BattLeDIM 2018 data.
 *
 * Honest by design: the real network has no embedded hydraulic model, so this
 * page shows SCADA-derived decision quantities (isolate / throttle / monitor /
 * dispatch) with stated assumptions — never a simulated outcome. Demo mode has
 * the true simulation; a banner here says exactly that.
 */
import { useEffect, useMemo, useState } from 'react'
import { Wrench, Gauge, Eye, Users, MapPin, CheckCircle2, AlertTriangle, Scale } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from './ui/card'
import { Badge } from './ui/badge'
import LTownMap from './LTownMap'
import { fetchRealDataMetadata, fetchRealDataRespond } from '../api'

let metaCache = null

const OPTION_ICONS = { isolate: Wrench, throttle: Gauge, monitor: Eye, dispatch: Users }

function Saving({ saving }) {
  if (!saving) return null
  if (saving.kind === 'point') {
    return (
      <p className="text-lg font-bold text-emerald-300">
        {Number(saving.lph).toLocaleString()} <span className="text-xs font-normal text-slate-400">L/hr saved</span>
      </p>
    )
  }
  if (saving.kind === 'range') {
    return (
      <p className="text-lg font-bold text-amber-300">
        {Number(saving.low_lph).toLocaleString()}–{Number(saving.high_lph).toLocaleString()}{' '}
        <span className="text-xs font-normal text-slate-400">L/hr saved (range)</span>
      </p>
    )
  }
  if (saving.kind === 'projection') {
    return (
      <p className="text-lg font-bold text-slate-200">
        ~{Number(saving.next_24h_m3).toLocaleString()} <span className="text-xs font-normal text-slate-400">m³ lost per 24 h if nothing is done</span>
      </p>
    )
  }
  return <p className="text-sm text-slate-300">{saving.note}</p>
}

function Confidence({ value }) {
  const pct = Math.round(value * 100)
  return (
    <div>
      <div className="flex items-center justify-between text-[10px] font-mono text-slate-500">
        <span>confidence</span>
        <span className={pct >= 75 ? 'text-emerald-400' : pct >= 50 ? 'text-amber-400' : 'text-slate-400'}>{pct}%</span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
        <div
          className={`h-full rounded-full ${pct >= 75 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-slate-600'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

export default function RealWhatIfPage({ onPlanDone }) {
  const [events, setEvents] = useState([])
  const [pipe, setPipe] = useState('p232')
  const [points, setPoints] = useState(24)
  const [plan, setPlan] = useState(null)
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
    // One call: the backend slices the window and scores it with the
    // benchmark's causal 14-day baseline (first cold call builds the frame).
    fetchRealDataRespond({ event_pipe: pipe || undefined, points })
      .then((r) => {
        if (!cancelled) {
          setPlan(r || null)
          setLoading(false)
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e?.message || 'Response planner request failed')
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [pipe, points])

  const sit = plan?.situation || {}
  const sag = useMemo(() => sit.sag_sensors || [], [sit])
  const targetPipe = sit.target_pipe?.pipe || null

  return (
    <div className="space-y-4">
      {/* Honesty banner — this page's whole credibility rests on it */}
      <div className="flex items-start gap-3 rounded-xl border border-cyan-700/40 bg-cyan-950/20 p-4">
        <Scale className="mt-0.5 h-5 w-5 shrink-0 text-cyan-400" />
        <div className="text-xs leading-relaxed text-cyan-100/90">
          <span className="font-semibold text-cyan-300">Honest response planning.</span> The real network has no
          embedded hydraulic model, so this page does <span className="font-semibold">not simulate</span> outcomes.
          Instead it computes what SCADA data can honestly support: the measured loss rate, physically-grounded saving
          estimates with stated assumptions, and a concrete dispatch package. Demo mode has the true intervention
          simulation — switch to <span className="text-slate-300">Demo Sim</span> to see it.
        </div>
      </div>

      {/* Controls */}
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
          BATTLEDIM 2018 REAL · SCADA-only planner
        </Badge>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-700/40 bg-amber-950/20 p-4 text-xs text-amber-200">
          <AlertTriangle className="h-4 w-4" /> {error} — the backend may be cold-starting; try again shortly.
        </div>
      )}

      {!plan && !error && (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center text-xs text-slate-400">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
          Building the response plan from the SCADA window…
        </div>
      )}

      {plan && (
        <>
          {/* Recommendation */}
          <div className="rounded-xl border border-emerald-700/50 bg-emerald-950/30 p-4">
            <p className="flex items-center gap-2 text-sm font-bold text-emerald-300">
              <CheckCircle2 className="h-5 w-5" />
              Recommended: {plan.recommended.primary.toUpperCase()}
              {plan.recommended.supporting?.length > 0 && (
                <span className="font-mono text-[11px] font-normal text-emerald-200/80">
                  + {plan.recommended.supporting.join(' + ')}
                </span>
              )}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-emerald-100/80">{plan.recommended.reason}</p>
          </div>

          {/* Situation strip */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-slate-800 bg-[#0c1626]/85 p-4">
              <p className="text-[10px] font-mono uppercase tracking-wider text-slate-400">Current loss (SCADA est.)</p>
              <p className="mt-1 text-2xl font-bold text-rose-300">{Number(sit.recent_loss_lph || 0).toLocaleString()} <span className="text-xs font-normal text-slate-400">L/hr</span></p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {sit.loss_now ? 'mean of last 30 min' : 'loss appeared in window but has stopped'} · peak {sit.peak_loss_m3h} m³/h · {sit.severity}
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-[#0c1626]/85 p-4">
              <p className="text-[10px] font-mono uppercase tracking-wider text-slate-400">Where</p>
              <p className="mt-1 text-lg font-bold text-amber-300">{targetPipe ? `Pipe ${targetPipe}` : 'no target'}</p>
              <p className="mt-0.5 text-[11px] text-slate-500">{sit.primary_branch_label || 'branch unknown'}{sit.localized ? ' · localized' : ''}</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-[#0c1626]/85 p-4">
              <p className="text-[10px] font-mono uppercase tracking-wider text-slate-400">Evidence</p>
              <p className="mt-1 text-lg font-bold text-slate-200">{sag.length} sagging sensor{sag.length === 1 ? '' : 's'}</p>
              <p className="mt-0.5 text-[11px] text-slate-500">{sit.cumulative_volume_m3} m³ already lost in window</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-[#0c1626]/85 p-4">
              <p className="text-[10px] font-mono uppercase tracking-wider text-slate-400">Answer key (overlay)</p>
              <p className="mt-1 text-lg font-bold text-slate-200">
                {(plan.answer_key_overlay?.active_leaks_now || []).length || 0} leak pipe{(plan.answer_key_overlay?.active_leaks_now || []).length === 1 ? '' : 's'} active
              </p>
              <p className="mt-0.5 font-mono text-[11px] text-slate-500">{(plan.answer_key_overlay?.active_leaks_now || []).join(', ') || 'none'}</p>
            </div>
          </div>

          {/* Option cards */}
          <div className="grid gap-4 md:grid-cols-2">
            {(plan.options || []).map((o) => {
              const Icon = OPTION_ICONS[o.id] || Wrench
              const isPrimary = plan.recommended.primary === o.id
              const isSupporting = (plan.recommended.supporting || []).includes(o.id)
              return (
                <Card
                  key={o.id}
                  className={`border-slate-800/80 bg-[#0c1626]/85 backdrop-blur-sm ${
                    isPrimary ? 'border-emerald-600/60 shadow-lg shadow-emerald-900/20' : isSupporting ? 'border-cyan-600/40' : ''
                  }`}
                >
                  <CardHeader className="flex-row items-start justify-between space-y-0 pb-2">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-sm font-medium text-slate-200">
                        <Icon className="h-4 w-4 text-cyan-400" /> {o.title}
                        {isPrimary && (
                          <Badge className="border-emerald-600/60 bg-emerald-950/60 text-emerald-300 hover:bg-emerald-950/60">recommended</Badge>
                        )}
                        {isSupporting && !isPrimary && (
                          <Badge className="border-cyan-600/40 bg-cyan-950/40 text-cyan-300 hover:bg-cyan-950/40">supporting</Badge>
                        )}
                      </CardTitle>
                    </div>
                    {o.urgency !== 'n/a' && (
                      <span className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                        o.urgency === 'immediate'
                          ? 'border-rose-500/40 bg-rose-950/50 text-rose-300'
                          : 'border-amber-500/30 bg-amber-950/40 text-amber-300'
                      }`}>
                        {o.urgency}
                      </span>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-2.5 text-xs">
                    <p className="leading-relaxed text-slate-300">{o.action}</p>
                    <Saving saving={o.saving} />
                    {o.saving?.note && <p className="text-[11px] leading-relaxed text-slate-500">{o.saving.note}</p>}
                    <div className="space-y-1 rounded-lg border border-slate-800 bg-slate-900/50 p-2.5 text-[11px] leading-relaxed">
                      <p className="text-slate-400"><span className="font-semibold text-slate-300">Data basis:</span> {o.data_basis}</p>
                      <p className="text-slate-400"><span className="font-semibold text-slate-300">Risks:</span> {o.risks}</p>
                    </div>
                    <Confidence value={o.confidence} />
                  </CardContent>
                </Card>
              )
            })}
          </div>

          {/* Dispatch package + map */}
          <Card className="border-slate-800/80 bg-[#0c1626]/85 backdrop-blur-sm">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-slate-200">
                <MapPin className="h-4 w-4 text-amber-400" /> Field-crew dispatch package — L-Town GIS
              </CardTitle>
              <CardDescription className="text-[11px]">
                The amber-highlighted pipe is the closest network pipe to the centre of the sagging-sensor cluster —
                the crew&apos;s first inspection target. Red sensor = strongest pressure drop.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 lg:grid-cols-3">
              <div className="h-[320px] lg:col-span-2">
                <LTownMap sensors={sag} reactedSensor={sit.reacted_sensor || sag[0] || null} activeLeaks={targetPipe ? [targetPipe] : []} />
              </div>
              <div className="space-y-2 text-xs">
                <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-slate-500">Inspection target</p>
                  <p className="mt-1 font-mono text-sm text-amber-200">{targetPipe ? `Pipe ${targetPipe}` : 'no cluster to target'}</p>
                  {sit.target_pipe && (
                    <p className="text-[10px] text-slate-500">±{sit.target_pipe.dist_model_m} model-m from cluster centroid</p>
                  )}
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-slate-500">Sensors that reacted</p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {sag.length === 0 && <span className="text-slate-500">none below threshold</span>}
                    {sag.map((s) => (
                      <span key={s} className="rounded border border-amber-500/30 bg-amber-950/40 px-1.5 py-0.5 font-mono text-[10px] text-amber-300">{s}</span>
                    ))}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-slate-500">Supply branch</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-300">{sit.primary_branch_label || '—'}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Assumptions */}
          <Card className="border-slate-800/80 bg-[#0c1626]/85 backdrop-blur-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-200">Assumptions — read before acting on any number above</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1.5 text-[11px] leading-relaxed text-slate-400">
                {(plan.assumptions || []).map((a, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-amber-500" />
                    <span>{a}</span>
                  </li>
                ))}
              </ul>
              {onPlanDone && (
                <p className="mt-3 font-mono text-[10px] text-slate-600">
                  Report generated from window {plan.window?.start} → {plan.window?.end}
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
