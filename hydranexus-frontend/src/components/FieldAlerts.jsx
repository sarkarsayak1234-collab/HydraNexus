/**
 * FieldAlerts — demo-mode alert workflow.
 *
 * Trigger a demo incident → an alert appears here with full details → the
 * operator dispatches the nearest field worker → an SMS (mock in Phase 1)
 * is sent to the worker's phone with a secure one-tap resolve link → when the
 * worker taps it, the alert resolves itself on this screen automatically
 * (5-second polling of the backend, which owns the alert state).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { BellRing, Send, CheckCircle2, Clock, UserPlus, Phone, Wrench, Siren } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from './ui/card'
import { Badge } from './ui/badge'
import { fetchFieldAlerts, dispatchAlert, resolveAlert, addWorker } from '../api'

const SEV_TONE = {
  HIGH: 'border-rose-500/50 bg-rose-950/40 text-rose-300',
  MEDIUM: 'border-amber-500/40 bg-amber-950/40 text-amber-300',
  LOW: 'border-sky-500/40 bg-sky-950/40 text-sky-300',
}

function StatusChip({ status }) {
  if (status === 'ACTIVE')
    return (
      <Badge className="gap-1 border-rose-500/50 bg-rose-950/60 text-rose-300 hover:bg-rose-950/60">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-400" /> ACTIVE
      </Badge>
    )
  if (status === 'DISPATCHED')
    return <Badge className="border-amber-500/50 bg-amber-950/60 text-amber-300 hover:bg-amber-950/60">DISPATCHED</Badge>
  return <Badge className="border-emerald-600/50 bg-emerald-950/60 text-emerald-300 hover:bg-emerald-950/60">RESOLVED</Badge>
}

function AlertCard({ alert, workers, onDispatch, onResolve, busyId }) {
  const [openDispatch, setOpenDispatch] = useState(false)
  const zoneMatchFirst = useMemo(() => {
    const sorted = [...workers]
    sorted.sort((a, b) => (a.zone === alert.zone ? 0 : 1) - (b.zone === alert.zone ? 0 : 1))
    return sorted
  }, [workers, alert.zone])

  return (
    <div
      className={`rounded-xl border p-4 transition-all ${
        alert.status === 'ACTIVE'
          ? 'border-rose-500/50 bg-rose-950/20 shadow-lg shadow-rose-900/20'
          : alert.status === 'DISPATCHED'
            ? 'border-amber-500/40 bg-amber-950/15'
            : 'border-emerald-700/40 bg-emerald-950/15'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 text-sm font-bold text-slate-100">
            <Siren className={`h-4 w-4 ${alert.status === 'ACTIVE' ? 'animate-pulse text-rose-400' : 'text-slate-400'}`} />
            {alert.title}
          </p>
          <p className="mt-1 font-mono text-[11px] text-slate-400">
            {alert.type} · {alert.location} ({alert.zone}) · created {String(alert.created_at).slice(11, 19)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <StatusChip status={alert.status} />
          <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold ${SEV_TONE[alert.severity] || SEV_TONE.LOW}`}>
            {alert.severity}
          </span>
        </div>
      </div>

      <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-1.5">
          <p className="text-[9px] uppercase tracking-wider text-slate-500">Est. loss</p>
          <p className="font-mono text-xs text-rose-300">{Number(alert.loss_per_hour || 0).toLocaleString()} L/hr</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-1.5">
          <p className="text-[9px] uppercase tracking-wider text-slate-500">Zone</p>
          <p className="font-mono text-xs text-slate-200">{alert.zone}</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-1.5">
          <p className="text-[9px] uppercase tracking-wider text-slate-500">Segment</p>
          <p className="font-mono text-xs text-slate-200">{alert.location}</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-1.5">
          <p className="text-[9px] uppercase tracking-wider text-slate-500">Worker</p>
          <p className="font-mono text-xs text-slate-200">{alert.worker_name || '—'}</p>
        </div>
      </div>

      {Array.isArray(alert.details) && alert.details.length > 0 && (
        <ul className="mt-2 space-y-1 font-mono text-[10.5px] leading-relaxed text-slate-400">
          {alert.details.slice(0, 3).map((d, i) => (
            <li key={i} className="flex gap-1.5"><span className="text-slate-600">▸</span><span>{d}</span></li>
          ))}
        </ul>
      )}

      {alert.status === 'DISPATCHED' && alert.sms_preview && (
        <div className="mt-2.5 rounded-lg border border-slate-700 bg-[#0c1626] p-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[9px] font-mono uppercase tracking-wider text-slate-500">
              SMS sent to {alert.worker_phone} ({alert.sms_mode || 'mock'}) — waiting for the field tap…
            </p>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(alert.sms_preview || '')
                notify?.('Message + acknowledgment link copied — paste it into your phone browser to test the tap.', 'success')
              }}
              className="shrink-0 rounded border border-slate-700 bg-slate-900/80 px-1.5 py-0.5 text-[9px] font-mono text-cyan-300 hover:border-cyan-600/50"
              title="Copy the message + acknowledgment link"
            >
              copy link
            </button>
          </div>
          <pre className="mt-1 whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-slate-300">{alert.sms_preview}</pre>
        </div>
      )}

      {alert.status === 'RESOLVED' && (
        <p className="mt-2.5 flex items-center gap-1.5 text-xs text-emerald-300">
          <CheckCircle2 className="h-4 w-4" /> {alert.resolve_reason || 'Resolved'} · {String(alert.resolved_at).slice(11, 19)}
        </p>
      )}

      {alert.status === 'ACTIVE' && (
        <div className="mt-3">
          <button
            onClick={() => setOpenDispatch((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-rose-500"
          >
            <UserPlus className="h-3.5 w-3.5" /> Dispatch nearby field worker
          </button>
          {openDispatch && (
            <div className="mt-2.5 space-y-1.5 rounded-xl border border-slate-700 bg-[#0c1626] p-2.5">
              <p className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
                Field crew — sorted by zone match ({alert.zone} first) · tap to send SMS
              </p>
              {zoneMatchFirst.map((w) => (
                <button
                  key={w.id}
                  onClick={() => onDispatch(alert.id, w.id)}
                  disabled={busyId === alert.id}
                  className="flex w-full items-center justify-between rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-left hover:border-cyan-600/50 disabled:opacity-50"
                >
                  <span className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-cyan-950/60 text-cyan-300">
                      <Wrench className="h-3.5 w-3.5" />
                    </span>
                    <span>
                      <span className="block text-xs font-semibold text-slate-100">{w.name}</span>
                      <span className="block text-[10px] text-slate-500">{w.specialty} · {w.zone}</span>
                    </span>
                  </span>
                  <span className="flex items-center gap-1.5 font-mono text-[10px] text-cyan-300">
                    <Phone className="h-3 w-3" /> {w.phone}
                    <Send className="h-3 w-3" />
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {alert.status === 'DISPATCHED' && (
        <button
          onClick={() => onResolve(alert.id)}
          disabled={busyId === alert.id}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900/80 px-2.5 py-1.5 text-[11px] font-mono text-slate-300 hover:border-emerald-600/50 hover:text-emerald-300 disabled:opacity-50"
        >
          <Clock className="h-3.5 w-3.5" /> Operator override: mark resolved
        </button>
      )}
    </div>
  )
}

export default function FieldAlerts({ notify }) {
  const [data, setData] = useState({ alerts: [], workers: [] })
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '', zone: 'Zone B', specialty: 'Field crew' })
  const pollRef = useRef(null)

  const load = async () => {
    try {
      const j = await fetchFieldAlerts()
      setData({ alerts: j.alerts || [], workers: j.workers || [] })
    } catch {
      /* keep last state */
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    pollRef.current = setInterval(load, 5000) // live: the worker's tap lands here automatically
    return () => clearInterval(pollRef.current)
  }, [])

  const doDispatch = async (alertId, workerId) => {
    setBusyId(alertId)
    try {
      await dispatchAlert(alertId, workerId)
      await load()
      notify?.('Dispatched — SMS sent to the field worker.', 'success')
    } catch (e) {
      notify?.(e?.message || 'Dispatch failed', 'danger')
    } finally {
      setBusyId(null)
    }
  }

  const doResolve = async (alertId) => {
    setBusyId(alertId)
    try {
      await resolveAlert(alertId)
      await load()
    } finally {
      setBusyId(null)
    }
  }

  const doAddWorker = async () => {
    if (!form.name || !form.phone) {
      notify?.('Name and phone are required.', 'info')
      return
    }
    try {
      await addWorker(form)
      setForm({ name: '', phone: '', zone: 'Zone B', specialty: 'Field crew' })
      setShowAdd(false)
      await load()
      notify?.('Field worker added.', 'success')
    } catch (e) {
      notify?.(e?.message || 'Add failed', 'danger')
    }
  }

  const active = data.alerts.filter((a) => a.status === 'ACTIVE').length
  const dispatched = data.alerts.filter((a) => a.status === 'DISPATCHED').length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800/80 bg-[#0c1626]/60 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
          <BellRing className={`h-4 w-4 ${active > 0 ? 'animate-pulse text-rose-400' : 'text-slate-500'}`} />
          <span className="text-slate-400">
            {active > 0 ? `${active} ACTIVE alert${active > 1 ? 's' : ''}` : 'no active alerts'}
          </span>
          {dispatched > 0 && <span className="text-amber-400">· {dispatched} awaiting field acknowledgment</span>}
          <span className="text-slate-600">· live (5s poll)</span>
        </div>
        <button
          onClick={() => setShowAdd((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900/80 px-2.5 py-1.5 text-[11px] font-mono text-slate-300 hover:border-cyan-600/50 hover:text-cyan-300"
        >
          <UserPlus className="h-3.5 w-3.5" /> Manage crew
        </button>
      </div>

      {showAdd && (
        <Card className="border-slate-800/80 bg-[#0c1626]/85">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-200">Add field worker</CardTitle>
            <CardDescription className="text-[11px]">Demo crew directory — phone receives the dispatch SMS.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-5">
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name"
              className="h-9 rounded-md border border-input bg-background px-2 text-xs" />
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+91 phone"
              className="h-9 rounded-md border border-input bg-background px-2 text-xs font-mono" />
            <select value={form.zone} onChange={(e) => setForm({ ...form, zone: e.target.value })}
              className="h-9 rounded-md border border-input bg-background px-2 text-xs font-mono">
              {['Zone A', 'Zone B', 'Zone C'].map((z) => <option key={z}>{z}</option>)}
            </select>
            <input value={form.specialty} onChange={(e) => setForm({ ...form, specialty: e.target.value })} placeholder="Specialty"
              className="h-9 rounded-md border border-input bg-background px-2 text-xs" />
            <button onClick={doAddWorker}
              className="h-9 rounded-md bg-cyan-600 text-xs font-semibold text-white hover:bg-cyan-500">Add worker</button>
          </CardContent>
        </Card>
      )}

      {loading && <p className="py-6 text-center text-xs text-slate-500">Loading alerts…</p>}

      {!loading && data.alerts.length === 0 && (
        <Card className="border-slate-800/80 bg-[#0c1626]/85">
          <CardContent className="py-10 text-center">
            <BellRing className="mx-auto h-8 w-8 text-slate-600" />
            <p className="mt-3 text-sm text-slate-300">No alerts yet.</p>
            <p className="mt-1 text-xs text-slate-500">
              Trigger the demo (top bar → Trigger demo, or pick a scenario) — the leak/burst alert appears here with
              full details, then dispatch a nearby field worker by SMS.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {data.alerts.map((a) => (
          <AlertCard key={a.id} alert={a} workers={data.workers} onDispatch={doDispatch} onResolve={doResolve} busyId={busyId} />
        ))}
      </div>

      <p className="text-[10px] leading-relaxed text-slate-600">
        Phase 1: SMS is simulated (the exact message is shown on the dispatched card) — the acknowledgment link is a
        real URL that any phone can open, and tapping it resolves the alert here automatically. Phase 2 wires a real
        SMS provider behind the same endpoint.
      </p>
    </div>
  )
}
