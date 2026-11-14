/**
 * RealWhatIfPage — R3a: the response planner for the REAL BattLeDIM 2018 data.
 *
 * Honest by design: the real network has no embedded hydraulic model, so this
 * page shows SCADA-derived decision quantities (isolate / throttle / monitor /
 * dispatch) with stated assumptions — never a simulated outcome. Demo mode has
 * the true simulation; a banner here says exactly that.
 */
import { useEffect, useMemo, useState } from 'react'
import { Wrench, Gauge, Eye, Users, MapPin, CheckCircle2, AlertTriangle, Scale, Cpu } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from './ui/card'
import { Badge } from './ui/badge'
import LTownMap from './LTownMap'
import { fetchRealDataMetadata, fetchRealDataRespond, fetchHydraulicWhatif, fetchHydraulicLocalize } from '../api'

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
  const sag = useMemo(() => sit.recent_loss_lph ? sit.sag_sensors : [], [sit])
  const targetPipe = sit.target_pipe?.pipe || null

  // Digital-twin simulation state (Option B)
  const [twin, setTwin] = useState(null) // { isolate: {...}, throttle: {...} }
  const [twinPhase, setTwinPhase] = useState('idle') // idle | running | done | error
  const [twinStep, setTwinStep] = useState('')
  const [twinError, setTwinError] = useState(null)

  const runTwin = async () => {
    if (!targetPipe || !sit.recent_loss_lph) return
    setTwinPhase('running')
    setTwinError(null)
    setTwin(null)
    const when = plan?.window?.end
    try {
      setTwinStep('Injecting the leak on pipe ' + targetPipe + ' and simulating isolation…')
      const iso = await fetchHydraulicWhatif({ leak_pipe: targetPipe, leak_lph: Math.max(500, sit.recent_loss_lph), action: 'isolate', when })
      setTwinStep('Simulating pressure throttling…')
      const thr = await fetchHydraulicWhatif({ leak_pipe: targetPipe, leak_lph: Math.max(500, sit.recent_loss_lph), action: 'throttle', throttle_target: 0.3, when })
      setTwin({ isolate: iso, throttle: thr })
      setTwinPhase('done')
    } catch (e) {
      setTwinError(e?.message || 'Hydraulic simulation failed')
      setTwinPhase('error')
    } finally {
      setTwinStep('')
    }
  }

  // Option A — model-based localization via residual fingerprint matching
  const [loc, setLoc] = useState(null)
  const [locPhase, setLocPhase] = useState('idle') // idle | running | done | error
  const [locError, setLocError] = useState(null)

  const runLocalize = async () => {
    setLocPhase('running')
    setLocError(null)
    setLoc(null)
    try {
      const r = await fetchHydraulicLocalize({ event_pipe: pipe || undefined, points })
      setLoc(r)
      setLocPhase('done')
    } catch (e) {
      setLocError(e?.message || 'Localization failed')
      setLocPhase('error')
    }
  }

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

          {/* Digital-twin simulation (Option B) */}
          <Card className="border-cyan-800/50 bg-[#0a1424]/90 backdrop-blur-sm">
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-2">
              <div>
                <CardTitle className="flex items-center gap-2 text-sm font-medium text-slate-200">
                  <Cpu className="h-4 w-4 text-cyan-400" /> Digital-twin check — real hydraulic simulation
                </CardTitle>
                <CardDescription className="max-w-3xl text-[11px]">
                  The official BattLeDIM EPANET model of this exact network (905 pipes, 785 nodes, pump &amp; tank
                  controls) is simulated with WNTR: the leak is injected <span className="text-slate-300">on pipe {targetPipe || '—'}</span> at
                  the SCADA-estimated size, then each intervention is actually run and the whole network recomputed.
                  Results are computed physics — the estimates above become numbers here.
                </CardDescription>
              </div>
              <button
                onClick={runTwin}
                disabled={twinPhase === 'running' || !targetPipe || !sit.recent_loss_lph}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-cyan-500 disabled:opacity-50"
              >
                <Cpu className="h-3.5 w-3.5" />
                {twinPhase === 'running' ? 'Simulating…' : twinPhase === 'done' ? 'Re-run simulation' : 'Run hydraulic simulation'}
              </button>
            </CardHeader>
            <CardContent>
              {/* Model-based localization block */}
              <div className="mb-4 rounded-xl border border-slate-800 bg-slate-900/40 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-bold text-slate-200">Where is it? — model-based localization</p>
                    <p className="mt-0.5 max-w-2xl text-[11px] leading-relaxed text-slate-500">
                      The twin simulates the healthy week, each sensor is calibrated against it, and the SCADA
                      pressure residuals (measured − expected) are matched against simulated leak fingerprints on
                      candidate pipes. Candidates come from the SCADA residuals alone; the answer key only scores
                      the result afterwards. Cold run ≈ 1–2 min (week-long baseline + one fingerprint sim per
                      candidate).
                    </p>
                  </div>
                  <button
                    onClick={runLocalize}
                    disabled={locPhase === 'running'}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-cyan-600/50 bg-cyan-950/40 px-3 py-1.5 text-xs font-semibold text-cyan-300 hover:bg-cyan-900/40 disabled:opacity-50"
                  >
                    <MapPin className="h-3.5 w-3.5" />
                    {locPhase === 'running' ? 'Matching fingerprints…' : 'Locate with the twin'}
                  </button>
                </div>
                {locPhase === 'running' && (
                  <p className="mt-2 flex items-center gap-2 text-xs text-cyan-300">
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" /> Simulating the healthy week + fingerprints…
                  </p>
                )}
                {locPhase === 'error' && (
                  <p className="mt-2 text-xs text-amber-300">{locError}</p>
                )}
                {loc && (
                  <div className="mt-2.5 space-y-2">
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="rounded border border-cyan-500/40 bg-cyan-950/50 px-2 py-0.5 font-mono text-cyan-300">
                        twin best match: pipe {loc.twin_localized?.pipe} ({loc.twin_localized?.match_pct}%)
                      </span>
                      {loc.scada_localized && (
                        <span className="rounded border border-slate-700 bg-slate-900/70 px-2 py-0.5 font-mono text-slate-300">
                          SCADA estimate: pipe {loc.scada_localized.pipe}
                        </span>
                      )}
                      {loc.answer_key_overlay?.true_pipe && (
                        <span className="rounded border border-amber-500/40 bg-amber-950/40 px-2 py-0.5 font-mono text-amber-300">
                          answer key: pipe {loc.answer_key_overlay.true_pipe}
                        </span>
                      )}
                    </div>
                    <table className="w-full text-left text-[11px]">
                      <thead>
                        <tr className="border-b border-slate-800 text-[9px] font-mono uppercase tracking-wider text-slate-500">
                          <th className="py-1.5 pr-3">#</th>
                          <th className="py-1.5 pr-3">Candidate pipe</th>
                          <th className="py-1.5 pr-3">Dist. to sag centroid</th>
                          <th className="py-1.5">Match</th>
                        </tr>
                      </thead>
                      <tbody className="font-mono">
                        {(loc.candidates || []).slice(0, 6).map((c) => (
                          <tr key={c.pipe} className="border-b border-slate-900/70">
                            <td className="py-1.5 pr-3 text-slate-500">{c.rank}</td>
                            <td className="py-1.5 pr-3 font-semibold text-slate-200">{c.pipe}</td>
                            <td className="py-1.5 pr-3 text-slate-400">{c.dist_model_m != null ? `${c.dist_model_m} m` : '—'}</td>
                            <td className="py-1.5 text-cyan-300">{c.match_pct}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="text-[10px] leading-relaxed text-slate-500">
                      {loc.candidates?.length > 1 &&
                        Math.abs((loc.candidates[0]?.match_pct || 0) - (loc.candidates[1]?.match_pct || 0)) < 3
                        ? 'Top candidates tie within noise — 33 sensors resolve the leak to this NEIGHBORHOOD; individual pipes inside it are hydraulically indistinguishable at this sensor density. Crews sweep the area, starting at the top match.'
                        : 'Correlation scores are conservative: the twin is a typical-week model, not a replay of 2018.'}
                    </p>
                  </div>
                )}
              </div>

              {!targetPipe && <p className="text-xs text-slate-500">No target pipe in this window — run the planner on a leak window first.</p>}
              {twinPhase === 'running' && (
                <p className="flex items-center gap-2 text-xs text-cyan-300">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" /> {twinStep} (each run recomputes all 905 pipes)
                </p>
              )}
              {twinPhase === 'error' && (
                <div className="flex items-center gap-2 rounded-lg border border-amber-700/40 bg-amber-950/20 p-3 text-xs text-amber-200">
                  <AlertTriangle className="h-4 w-4" /> {twinError} — the model simulation may be cold; try again.
                </div>
              )}
              {twin && (
                <div className="mt-1 space-y-3">
                  <div className="grid gap-3 lg:grid-cols-2">
                    {/* Isolate result */}
                    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
                      <p className="flex items-center gap-1.5 text-xs font-bold text-slate-200">
                        <Wrench className="h-3.5 w-3.5 text-cyan-400" /> Isolate pipe {twin.isolate.leak_pipe} — simulated
                        {twin.isolate.leak.leak_stopped ? (
                          <Badge className="border-emerald-600/60 bg-emerald-950/60 text-emerald-300 hover:bg-emerald-950/60">leak fully stopped</Badge>
                        ) : (
                          <Badge className="border-amber-600/60 bg-amber-950/60 text-amber-300 hover:bg-amber-950/60">leak reduced</Badge>
                        )}
                      </p>
                      <div className="mt-2 grid grid-cols-3 gap-2 font-mono text-[11px]">
                        <div className="rounded border border-slate-800 bg-slate-950/60 p-2">
                          <p className="text-[9px] uppercase text-slate-500">leak flow</p>
                          <p className="text-slate-200">{twin.isolate.leak.delivered_lph_no_action} → <span className="text-emerald-400">{twin.isolate.leak.delivered_lph_with_action}</span> L/h</p>
                        </div>
                        <div className="rounded border border-slate-800 bg-slate-950/60 p-2">
                          <p className="text-[9px] uppercase text-slate-500">system inflow</p>
                          <p className="text-slate-200">{Number(twin.isolate.system_inflow_lph.with_leak).toLocaleString()} → <span className="text-emerald-400">{Number(twin.isolate.system_inflow_lph.with_action).toLocaleString()}</span></p>
                        </div>
                        <div className="rounded border border-slate-800 bg-slate-950/60 p-2">
                          <p className="text-[9px] uppercase text-slate-500">nodes losing service</p>
                          <p className={twin.isolate.pressure_impact.nodes_losing_service_count > 0 ? 'text-amber-400' : 'text-emerald-400'}>
                            {twin.isolate.pressure_impact.nodes_losing_service_count}
                          </p>
                        </div>
                      </div>
                      <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
                        Leak junction pressure: {twin.isolate.leak.junction_pressure_m.with_leak} m → {twin.isolate.leak.junction_pressure_m.with_action} m.
                        {twin.isolate.pressure_impact.nodes_losing_service_count === 0
                          ? ' No node drops below the 15 m service floor — looped network reroutes cleanly.'
                          : ' Some nodes lose service — crews must plan tankering/alternative supply.'}
                      </p>
                    </div>

                    {/* Throttle result */}
                    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
                      <p className="flex items-center gap-1.5 text-xs font-bold text-slate-200">
                        <Gauge className="h-3.5 w-3.5 text-cyan-400" /> Throttle pipe {twin.throttle.leak_pipe} −30% — simulated
                        <Badge className="border-cyan-600/40 bg-cyan-950/40 text-cyan-300 hover:bg-cyan-950/40">physics, not a range</Badge>
                      </p>
                      <div className="mt-2 grid grid-cols-2 gap-2 font-mono text-[11px]">
                        <div className="rounded border border-slate-800 bg-slate-950/60 p-2">
                          <p className="text-[9px] uppercase text-slate-500">leak flow</p>
                          <p className="text-slate-200">{twin.throttle.leak.delivered_lph_no_action} → <span className="text-cyan-300">{twin.throttle.leak.delivered_lph_with_action}</span> L/h</p>
                        </div>
                        <div className="rounded border border-slate-800 bg-slate-950/60 p-2">
                          <p className="text-[9px] uppercase text-slate-500">reduction</p>
                          <p className="text-cyan-300">
                            {twin.throttle.leak.delivered_lph_no_action > 0
                              ? `${Math.round((1 - twin.throttle.leak.delivered_lph_with_action / Math.max(twin.throttle.leak.delivered_lph_no_action, 0.001)) * 100)}%`
                              : '—'}
                          </p>
                        </div>
                      </div>
                      <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
                        Throttle applied via minor loss k={twin.throttle.throttle?.minor_loss_k} on both pipe halves. In a
                        looped network, water reroutes around a throttle — the real leak reduction may be smaller than the
                        naive 11–42% rule of thumb. This number is the truth for THIS network.
                      </p>
                    </div>
                  </div>

                  {/* Twin map */}
                  <div>
                    <p className="mb-1.5 text-[10px] font-mono uppercase tracking-wider text-slate-500">
                      Network after the simulated isolation — every pipe colored by its simulated flow
                    </p>
                    <div className="h-[360px] w-full">
                      <LTownMap
                        pipeFlows={twin.isolate.pipes_after_action}
                        activeLeaks={[targetPipe]}
                        sensors={sag}
                        fitMode="network"
                      />
                    </div>
                    <p className="mt-1.5 text-[10px] font-mono text-slate-500">
                      <span className="text-cyan-400">bright cyan</span> = high simulated flow · dark = low flow ·{' '}
                      <span className="text-amber-400">amber</span> = the isolated pipe (0 flow) · hover any pipe for its
                      simulated flow · sensor chips = SCADA sag cluster
                    </p>
                  </div>
                  <p className="font-mono text-[10px] text-slate-600">{twin.isolate.provenance?.note}</p>
                </div>
              )}
            </CardContent>
          </Card>

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
