import {
  LayoutDashboard,
  Network,
  Activity,
  FileSearch,
  Gauge,
  FlaskConical,
  History,
  Settings,
  Droplets,
  Play,
  X,
  Database,
  ShieldCheck,
} from 'lucide-react'
import { cn } from '../lib/utils'
import { Badge } from './ui/badge'

const items = [
  ['overview', LayoutDashboard, 'Overview'],
  ['network', Network, 'Network'],
  ['monitoring', Activity, 'Telemetry'],
  ['real_scada', Database, 'Real SCADA Data'],
  ['validation', ShieldCheck, 'Validation'],
  ['incident', FileSearch, 'Investigation'],
  ['impact', Gauge, 'Impact'],
  ['whatif', FlaskConical, 'What-If'],
  ['history', History, 'History'],
]

export default function Sidebar({
  page,
  setPage,
  mobileOpen,
  onClose,
  incidentActive,
  onReplayBriefing,
  dataSourceMode = 'demo',
  setDataSourceMode,
}) {
  return (
    <>
      {mobileOpen && (
        <button aria-label="Close navigation" className="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs lg:hidden" onClick={onClose} />
      )}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-60 transform flex-col border-r border-slate-800/80 bg-[#0c1626]/95 backdrop-blur-md transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex items-center justify-between px-4 pt-5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-600 text-white shadow-sm shadow-sky-500/25">
              <Droplets className="h-4 w-4" />
            </span>
            <div>
              <span className="block text-sm font-bold tracking-tight text-white leading-tight">HydraNexus</span>
              <span className="block text-[10px] font-mono text-sky-400">Decision Intelligence</span>
            </div>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-800 lg:hidden" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-3 pt-4">
          <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${incidentActive ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`} />
              <span className="text-xs font-mono text-slate-300">{incidentActive ? 'ANOMALY DETECTED' : 'SYSTEM NOMINAL'}</span>
            </div>
            {incidentActive ? (
              <span className="text-[10px] font-mono font-bold text-amber-400 bg-amber-950/60 border border-amber-800/80 px-1.5 py-0.5 rounded">Active</span>
            ) : (
              <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-800/80 px-1.5 py-0.5 rounded">Stable</span>
            )}
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {items.map(([key, Icon, label]) => {
            const isRealScada = key === 'real_scada'
            const isMonitoring = key === 'monitoring'
            const isActive = isRealScada
              ? page === 'monitoring' && dataSourceMode === 'real'
              : isMonitoring
              ? page === 'monitoring' && dataSourceMode === 'demo'
              : page === key

            return (
              <button
                key={key}
                onClick={() => {
                  if (isRealScada) {
                    setDataSourceMode?.('real')
                    setPage('monitoring')
                  } else if (isMonitoring) {
                    setDataSourceMode?.('demo')
                    setPage('monitoring')
                  } else {
                    setPage(key)
                  }
                  onClose()
                }}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition-all cursor-pointer',
                  isActive
                    ? isRealScada
                      ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-700/80 font-semibold shadow-xs'
                      : 'bg-sky-950/80 text-sky-400 border border-sky-800/80 font-semibold shadow-xs'
                    : isRealScada
                    ? 'text-emerald-400/80 hover:bg-emerald-950/30 hover:text-emerald-200'
                    : 'text-slate-400 hover:bg-slate-900/60 hover:text-slate-200'
                )}
              >
                <Icon
                  className={cn(
                    'h-4 w-4 shrink-0',
                    isActive
                      ? isRealScada
                        ? 'text-emerald-400'
                        : 'text-sky-400'
                      : isRealScada
                      ? 'text-emerald-500/70'
                      : 'text-slate-500'
                  )}
                />
                <span>{label}</span>
                {isRealScada && (
                  <span className="ml-auto rounded bg-emerald-500/20 border border-emerald-500/40 px-1.5 py-0.5 text-[9px] font-mono font-semibold text-emerald-300">
                    2018
                  </span>
                )}
                {key === 'incident' && incidentActive && (
                  <span className="ml-auto flex h-2 w-2 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                  </span>
                )}
              </button>
            )
          })}
        </nav>

        {/* Briefing Replay Trigger & Settings */}
        <div className="border-t border-slate-800/80 p-3 space-y-1">
          {onReplayBriefing && (
            <button
              onClick={() => {
                onReplayBriefing()
                onClose()
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-mono text-sky-400 bg-sky-950/30 border border-sky-900/40 hover:bg-sky-900/40 hover:text-sky-300 transition-colors"
            >
              <Play className="h-3.5 w-3.5 shrink-0 fill-current" />
              <span>System Briefing</span>
            </button>
          )}

          <button
            onClick={() => {
              setPage('settings')
              onClose()
            }}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors',
              page === 'settings'
                ? 'bg-sky-950/80 text-sky-400 border border-sky-800/80 font-semibold'
                : 'text-slate-400 hover:bg-slate-900/60 hover:text-slate-200'
            )}
          >
            <Settings className="h-4 w-4 shrink-0 text-slate-500" />
            Settings
          </button>
          <p className="px-2 pt-2 text-[10px] font-mono leading-3 text-slate-500">
            Human-in-the-loop decision support. Operators remain in control.
          </p>
        </div>
      </aside>
    </>
  )
}
