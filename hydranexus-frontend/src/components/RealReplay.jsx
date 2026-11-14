/**
 * RealReplay — R4: Live Replay mode for the REAL BattLeDIM 2018 data.
 *
 * Streams a real leak episode through the actual detector in accelerated
 * time: the window is scored server-side ONCE (same causal 14-day baseline
 * as the ground-truth benchmark, SCADA-only inputs), then the player sweeps
 * through it locally — no backend calls during playback, so it is smooth
 * even on a cold free-tier instance.
 *
 * The drama is real: the alarm fires at exactly the benchmark's recorded
 * moment (e.g. p673 → 25 min after the leak starts), with sound, an alarm
 * banner and the reacting sensor highlighted on the L-Town map.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Play, Pause, RotateCcw, Radio, Siren, CheckCircle2, AlertTriangle } from 'lucide-react'
import { AreaChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from './ui/card'
import { Badge } from './ui/badge'
import LTownMap from './LTownMap'
import { fetchRealDataReplay } from '../api'

const SPEEDS = [
  { label: '×300 · cinematic', ms: 1000 },
  { label: '×900 · brisk', ms: 333 },
  { label: '×3000 · turbo', ms: 100 },
]

// Two short alarm beeps via WebAudio (no asset files; created after a user
// gesture so autoplay policies never block it).
function playAlarmBeep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const t0 = ctx.currentTime
    for (const offset of [0, 0.35]) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'square'
      osc.frequency.value = 880
      gain.gain.setValueAtTime(0.0001, t0 + offset)
      gain.gain.exponentialRampToValueAtTime(0.12, t0 + offset + 0.03)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.22)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t0 + offset)
      osc.stop(t0 + offset + 0.25)
    }
    setTimeout(() => ctx.close?.(), 1500)
  } catch { /* audio is garnish — never break playback over it */ }
}

export default function RealReplay({ notify }) {
  const [pipe, setPipe] = useState('p673')
  const [speedIdx, setSpeedIdx] = useState(0)
  const [payload, setPayload] = useState(null)
  const [phase, setPhase] = useState('idle') // idle | loading | playing | paused | done
  const [idx, setIdx] = useState(0)
  const [error, setError] = useState(null)
  const [alarmFired, setAlarmFired] = useState(false)
  const timerRef = useRef(null)

  const steps = payload?.steps || []
  const detection = payload?.detection || {}
  const episode = payload?.episode || {}
  const win = payload?.window || {}
  const current = steps[Math.min(idx, steps.length - 1)] || null

  // Playback ticker — one interval, cleared on every state change.
  useEffect(() => {
    if (phase !== 'playing' || !steps.length) return
    const ms = SPEEDS[speedIdx].ms
    timerRef.current = setInterval(() => {
      setIdx((i) => {
        if (i + 1 >= steps.length - 1) {
          clearInterval(timerRef.current)
          setPhase('done')
          return steps.length - 1
        }
        return i + 1
      })
    }, ms)
    return () => clearInterval(timerRef.current)
  }, [phase, speedIdx, steps.length])

  // The moment: first sustained-alarm step crossing.
  useEffect(() => {
    if (!steps.length) return
    const fireAt = detection.alarm_step_index
    if (fireAt != null && idx >= fireAt && !alarmFired) {
      setAlarmFired(true)
      playAlarmBeep()
    }
  }, [idx, steps.length, detection.alarm_step_index, alarmFired])

  const start = async () => {
    setError(null)
    setPhase('loading')
    try {
      const p = await fetchRealDataReplay(pipe)
      setPayload(p)
      setIdx(0)
      setAlarmFired(false)
      setPhase('playing')
    } catch (e) {
      setError(e?.message || 'Replay request failed')
      setPhase('idle')
    }
  }

  const restart = () => {
    setIdx(0)
    setAlarmFired(false)
    setPhase('playing')
  }

  const reset = () => {
    clearInterval(timerRef.current)
    setPayload(null)
    setPhase('idle')
    setIdx(0)
    setAlarmFired(false)
  }

  const shown = useMemo(
    () =>
      steps.slice(0, idx + 1).map((s) => ({
        ...s,
        flow_red: s.sustained || s.alarm ? s.flow : null,
      })),
    [steps, idx],
  )
  const alarmNow = current?.sustained || current?.alarm
  const watchNow = !alarmNow && (current?.z_flow ?? 0) >= 1.5
  const status = alarmNow ? 'ALARM' : watchNow ? 'WATCH' : 'NOMINAL'

  const fmtClock = (t) => (t ? String(t).slice(11) : '—')

  return (
    <Card className="border-slate-800/80 bg-[#0c1626]/85 backdrop-blur-sm">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-2">
        <div>
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-slate-200">
            <Radio className="h-4 w-4 text-rose-400" /> Live Replay — watch a real 2018 leak happen
          </CardTitle>
          <CardDescription className="max-w-2xl text-[11px]">
            A 12-hour window around a real BattLeDIM leak, played back in accelerated time. The SAME detector runs
            live (causal baseline, SCADA-only) — when it alarms, that is a real detection, at the same latency the
            ground-truth benchmark measured.
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={pipe}
            onChange={(e) => { setPipe(e.target.value); reset() }}
            disabled={phase === 'playing' || phase === 'loading'}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs font-mono"
          >
            {['p673', 'p461', 'p232', 'p628', 'p538', 'p31', 'p158', 'p369', 'p183', 'p866'].map((p) => (
              <option key={p} value={p}>Pipe {p}</option>
            ))}
          </select>
          <select
            value={speedIdx}
            onChange={(e) => setSpeedIdx(Number(e.target.value))}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs font-mono"
          >
            {SPEEDS.map((s, i) => (
              <option key={s.label} value={i}>{s.label}</option>
            ))}
          </select>
          {phase === 'idle' || phase === 'loading' ? (
            <button
              onClick={start}
              disabled={phase === 'loading'}
              className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-rose-500 disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5" /> {phase === 'loading' ? 'Scoring window…' : 'Start replay'}
            </button>
          ) : (
            <>
              <button
                onClick={() => setPhase(phase === 'playing' ? 'paused' : 'playing')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900/80 px-2.5 py-1.5 text-xs font-mono text-slate-200 hover:border-cyan-600/50"
              >
                {phase === 'playing' ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                {phase === 'playing' ? 'Pause' : 'Resume'}
              </button>
              <button onClick={restart} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900/80 px-2.5 py-1.5 text-xs font-mono text-slate-200 hover:border-cyan-600/50">
                <RotateCcw className="h-3.5 w-3.5" /> Restart
              </button>
              <button onClick={reset} className="rounded-lg border border-slate-700 bg-slate-900/80 px-2.5 py-1.5 text-xs font-mono text-slate-400 hover:text-white">
                Close
              </button>
            </>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-700/40 bg-amber-950/20 p-3 text-xs text-amber-200">
            <AlertTriangle className="h-4 w-4" /> {error}
          </div>
        )}

        {phase === 'idle' && !error && (
          <p className="py-6 text-center text-xs text-slate-500">
            Pick an episode and press <span className="font-semibold text-rose-400">Start replay</span>. Try{' '}
            <span className="font-mono text-cyan-400">p673</span> — detected in 25 minutes in the benchmark.
          </p>
        )}

        {payload && current && (
          <div className="space-y-3">
            {/* Alarm banner */}
            {alarmFired && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-500/60 bg-rose-950/50 px-4 py-2.5 shadow-lg shadow-rose-900/30">
                <div className="flex items-center gap-2 text-sm font-bold text-rose-300">
                  <Siren className="h-5 w-5 animate-pulse" />
                  DETECTOR ALARM — sustained for 3 consecutive readings
                </div>
                <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-rose-200/90">
                  <span>
                    fired {fmtClock(detection.alarm_time)} · {detection.latency_min != null ? `${detection.latency_min} min after leak start` : ''}
                  </span>
                  <span className="rounded border border-rose-500/40 bg-rose-900/50 px-1.5 py-0.5">
                    reacting sensor {detection.reacted_sensor || current.reacted_sensor || '—'}
                  </span>
                </div>
              </div>
            )}

            {/* Status strip */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
                <p className="text-[10px] font-mono uppercase tracking-wider text-slate-500">Replay clock</p>
                <p className="mt-1 font-mono text-lg font-bold text-slate-100">{fmtClock(current.time)}</p>
                <p className="text-[10px] text-slate-500">{String(current.time).slice(0, 10)} · step {idx + 1}/{steps.length}</p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
                <p className="text-[10px] font-mono uppercase tracking-wider text-slate-500">Status</p>
                <p className={`mt-1 text-lg font-bold tracking-wide ${
                  status === 'ALARM' ? 'animate-pulse text-rose-400' : status === 'WATCH' ? 'text-amber-400' : 'text-emerald-400'
                }`}>
                  {status}
                </p>
                <p className="text-[10px] text-slate-500">{alarmFired ? 'detector alarmed earlier in this window' : 'live rule: inflow ↑ AND ≥3 sensors ↓ ×3 steps'}</p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
                <p className="text-[10px] font-mono uppercase tracking-wider text-slate-500">Total inflow</p>
                <p className={`mt-1 font-mono text-lg font-bold ${alarmNow ? 'text-rose-300' : 'text-cyan-300'}`}>
                  {current.flow ?? '—'} <span className="text-[10px] font-normal text-slate-500">m³/h</span>
                </p>
                <p className="text-[10px] text-slate-500">typical for this hour: {current.flow_typical ?? '—'}</p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
                <p className="text-[10px] font-mono uppercase tracking-wider text-slate-500">Network pressure</p>
                <p className="mt-1 font-mono text-lg font-bold text-slate-200">
                  {current.press_avg ?? '—'} <span className="text-[10px] font-normal text-slate-500">m</span>
                </p>
                <p className="text-[10px] text-slate-500">{current.press_vote} sensors below baseline</p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
                <p className="text-[10px] font-mono uppercase tracking-wider text-slate-500">Leak (answer key)</p>
                <p className="mt-1 font-mono text-lg font-bold text-amber-300">
                  {idx >= win.leak_start_step ? 'ACTIVE' : 'not yet'}
                </p>
                <p className="text-[10px] text-slate-500">starts {fmtClock(episode.start)} · labelled overlay only</p>
              </div>
            </div>

            {/* Progress with leak-start marker */}
            <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-rose-500 transition-all duration-150"
                style={{ width: `${((idx + 1) / steps.length) * 100}%` }}
              />
              <div
                className="absolute top-0 h-full w-0.5 bg-amber-400"
                style={{ left: `${(win.leak_start_step / steps.length) * 100}%` }}
                title="leak starts (answer key)"
              />
            </div>

            {/* Rolling chart */}
            <div className="h-[180px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={shown} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
                  <defs>
                    <linearGradient id="replay-grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0284c7" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#0284c7" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(148,163,184,0.08)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} axisLine={false}
                    tickFormatter={(t) => String(t).slice(11, 16)} interval="preserveStartEnd" minTickGap={40} />
                  <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} width={44} />
                  <Tooltip
                    contentStyle={{ background: '#0c1626', border: '1px solid #1e293b', borderRadius: 8, fontSize: 11 }}
                    labelFormatter={(t) => String(t)}
                  />
                  <Line type="monotone" dataKey="flow_typical" stroke="#94a3b8" strokeWidth={1.1} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
                  <Area type="monotone" dataKey="flow" stroke="#0284c7" strokeWidth={2} fill="url(#replay-grad)" isAnimationActive={false} />
                  <Area
                    type="monotone"
                    dataKey="flow_red"
                    stroke="#f43f5e"
                    strokeWidth={2.5}
                    fill="transparent"
                    connectNulls={false}
                    dot={{ r: 2.5, fill: '#f43f5e', strokeWidth: 0 }}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[10px] font-mono text-slate-500">
              <span className="text-cyan-400">blue</span> = live inflow · <span className="text-slate-400">dashed</span> = hour-of-day
              typical (causal baseline) · <span className="text-rose-400">red dots</span> = detector alarm steps ·{' '}
              <span className="text-amber-400">amber marker</span> on the bar = leak starts (answer key)
            </p>

            {/* Map */}
            <div className="grid gap-3 lg:grid-cols-3">
              <div className="h-[300px] lg:col-span-2">
                <LTownMap
                  reactedSensor={alarmFired ? (detection.reacted_sensor || current.reacted_sensor) : null}
                  activeLeaks={idx >= win.leak_start_step ? [episode.pipe] : []}
                />
              </div>
              <div className="space-y-2 text-xs">
                <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-slate-500">Episode (answer key)</p>
                  <p className="mt-1 font-mono text-sm text-amber-200">Pipe {episode.pipe} · {episode.max_rate_m3h} m³/h peak</p>
                  <p className="text-[10px] text-slate-500">{episode.start} → {episode.end} · {episode.kind} tier</p>
                </div>
                {alarmFired && (
                  <div className="rounded-lg border border-emerald-700/50 bg-emerald-950/30 p-3">
                    <p className="flex items-center gap-1.5 font-semibold text-emerald-300">
                      <CheckCircle2 className="h-4 w-4" /> Detection recorded
                    </p>
                    <p className="mt-1 font-mono text-[11px] text-emerald-200/80">
                      latency {detection.latency_min} min · localized {detection.reacted_sensor || '—'}
                    </p>
                    <p className="mt-1 text-[10px] text-slate-500">
                      Same detection rule and baseline as the Validation page benchmark — this replay just plays it
                      out in time.
                    </p>
                  </div>
                )}
                <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
                  <Badge className="border-emerald-700/60 bg-emerald-950/50 text-emerald-400 hover:bg-emerald-950/50">
                    BATTLEDIM 2018 REAL · causal baseline
                  </Badge>
                  <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
                    {payload.answer_key_note}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
