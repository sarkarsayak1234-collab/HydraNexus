import { useEffect } from 'react'
import { X, Info, Crosshair } from 'lucide-react'
import LTownMap from './LTownMap'

/**
 * Real-network fault map modal — backed by the REAL L-Town geometry from the
 * official BattLeDIM network file (no fabricated coordinates, unlike the
 * demo-mode tile map). Shows the reacting pressure sensor, the localized
 * segment and the active ground-truth leak pipes as a labelled overlay.
 */
export default function LTownMapModal({ isOpen, onClose, reactedSensor = null, activeLeaks = [] }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    if (isOpen) window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex h-[80vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-800 bg-[#0c1626] shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-bold text-white">
              <Crosshair className="h-4 w-4 text-rose-400" />
              L-Town Network GIS
              {reactedSensor && (
                <span className="ml-1 inline-flex items-center gap-1 rounded-full border border-rose-800/70 bg-rose-950/50 px-2 py-0.5 text-[10px] font-mono text-rose-300">
                  reacting sensor {reactedSensor}
                </span>
              )}
            </h3>
            <p className="mt-0.5 text-[11px] font-mono text-slate-500">
              Real geometry — BattLeDIM L-TOWN v1.2 (785 nodes · 905 pipes · 42.6 km) · model coordinates
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
            aria-label="Close map"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 p-3">
          <LTownMap reactedSensor={reactedSensor} activeLeaks={activeLeaks} />
        </div>

        <div className="flex items-start gap-2 border-t border-slate-800 px-5 py-2.5">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
          <p className="text-[10px] leading-relaxed text-slate-500">
            Rendered from the official BattLeDIM network file (KIOS Research). Coordinates are the network's native
            schematic model coordinates — not georeferenced to a real city. Leak pipes shown in amber are the
            published ground truth, displayed strictly as a labelled evaluation overlay; detection itself never reads it.
          </p>
        </div>
      </div>
    </div>
  )
}
