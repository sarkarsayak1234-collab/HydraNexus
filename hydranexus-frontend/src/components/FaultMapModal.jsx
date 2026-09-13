import { useState, useEffect, useRef } from 'react'
import {
  X,
  MapPin,
  Maximize2,
  Minimize2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Copy,
  Check,
  ExternalLink,
  Compass,
  Layers,
  Crosshair,
} from 'lucide-react'
import { Button } from './ui/button'
import { Badge } from './ui/badge'

export default function FaultMapModal({
  isOpen,
  onClose,
  location,
  incidentActive = true,
}) {
  const [zoom, setZoom] = useState(15)
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [copied, setCopied] = useState(false)
  const [tileError, setTileError] = useState(false)
  const [layerType, setLayerType] = useState('dark') // 'dark' | 'grid'
  const mapContainerRef = useRef(null)

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  useEffect(() => {
    // Reset pan and zoom whenever a new location opens
    if (isOpen) {
      setZoom(15)
      setPanOffset({ x: 0, y: 0 })
      setTileError(false)
      setCopied(false)
    }
  }, [isOpen, location?.asset_id])

  if (!isOpen || !location) return null

  const lat = location.latitude ?? 22.5726
  const lng = location.longitude ?? 88.3639
  const assetId = location.asset_id || 'N3'
  const assetName = location.asset_name || 'B2 Junction'
  const source = location.location_source || location.source || 'Demo GIS'
  const isConfigured = location.configured !== false && location.latitude != null

  const handleMouseDown = (e) => {
    setIsDragging(true)
    setDragStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y })
  }

  const handleMouseMove = (e) => {
    if (!isDragging) return
    setPanOffset({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    })
  }

  const handleMouseUp = () => {
    setIsDragging(false)
  }

  const handleZoomIn = () => setZoom((z) => Math.min(18, z + 1))
  const handleZoomOut = () => setZoom((z) => Math.max(12, z - 1))
  const handleReset = () => {
    setZoom(15)
    setPanOffset({ x: 0, y: 0 })
  }

  const handleCopyCoords = () => {
    navigator.clipboard?.writeText(`${lat.toFixed(6)}, ${lng.toFixed(6)}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const osmUrl = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=${zoom}/${lat}/${lng}`
  const gmapsUrl = `https://www.google.com/maps?q=${lat},${lng}`

  // Calculate standard Web Mercator tile indices for center point
  const n = Math.pow(2, zoom)
  const tileX = Math.floor(((lng + 180) / 360) * n)
  const latRad = (lat * Math.PI) / 180
  const tileY = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n)

  // Generate 3x3 surrounding tiles for smooth raster map preview
  const tiles = []
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const tx = tileX + dx
      const ty = tileY + dy
      tiles.push({
        key: `${zoom}-${tx}-${ty}`,
        dx,
        dy,
        url: `https://a.basemaps.cartocdn.com/dark_all/${zoom}/${tx}/${ty}.png`,
      })
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div
        className="relative flex h-[90vh] max-h-[720px] w-full max-w-4xl flex-col rounded-2xl border border-slate-700 bg-[#0c1626] shadow-2xl overflow-hidden text-slate-100"
        role="dialog"
        aria-modal="true"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-[#091526]/95 px-5 py-3.5 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-950/80 border border-cyan-800/80 text-cyan-400 shadow-xs">
              <Compass className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold tracking-tight text-white sm:text-base">
                  Fault Location Map
                </h2>
                <span className="rounded bg-cyan-950/60 border border-cyan-700/60 px-2 py-0.2 text-[10px] font-mono font-semibold text-cyan-300">
                  {source}
                </span>
                {incidentActive && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-red-950/80 border border-red-700/80 px-2 py-0.2 text-[10px] font-mono font-semibold text-red-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse" />
                    FAULT SUSPECTED
                  </span>
                )}
              </div>
              <p className="text-xs font-mono text-slate-400">
                {assetId} · {assetName} ({lat.toFixed(4)}° N, {lng.toFixed(4)}° E)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-8 w-8 text-slate-400 hover:bg-slate-800 hover:text-white rounded-lg cursor-pointer"
              aria-label="Close map"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Map Viewport Area */}
        <div
          ref={mapContainerRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          className={`relative flex-1 overflow-hidden bg-[#060e1a] select-none ${
            isDragging ? 'cursor-grabbing' : 'cursor-grab'
          }`}
        >
          {/* Map Layer (Raster Tiles or Tactical Grid) */}
          <div
            className="absolute inset-0 transition-transform duration-75"
            style={{
              transform: `translate(${panOffset.x}px, ${panOffset.y}px)`,
            }}
          >
            {layerType === 'dark' && !tileError ? (
              <div
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
                style={{ width: '768px', height: '768px' }}
              >
                {tiles.map((t) => (
                  <img
                    key={t.key}
                    src={t.url}
                    alt=""
                    onError={() => setTileError(true)}
                    className="absolute h-[256px] w-[256px] opacity-85 pointer-events-none"
                    style={{
                      left: `${(t.dx + 1) * 256}px`,
                      top: `${(t.dy + 1) * 256}px`,
                    }}
                  />
                ))}
              </div>
            ) : null}

            {/* Tactical Grid / Sonar Overlay */}
            <div
              className="absolute inset-0 pointer-events-none opacity-25"
              style={{
                backgroundImage:
                  'linear-gradient(to right, #0ea5e9 1px, transparent 1px), linear-gradient(to bottom, #0ea5e9 1px, transparent 1px)',
                backgroundSize: '48px 48px',
              }}
            />

            {/* Concentric Range Rings centered on asset */}
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
              <div className="h-48 w-48 rounded-full border border-cyan-500/20" />
              <div className="absolute inset-0 -m-16 h-80 w-80 rounded-full border border-cyan-500/15" />
              <div className="absolute inset-0 -m-32 h-[440px] w-[440px] rounded-full border border-cyan-500/10" />
            </div>

            {/* Target Crosshair Reticle */}
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
              <div className="absolute -left-12 top-0 h-[1px] w-24 bg-cyan-500/40" />
              <div className="absolute left-0 -top-12 h-24 w-[1px] bg-cyan-500/40" />
            </div>

            {/* Suspected Fault Beacon Marker */}
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20 flex flex-col items-center pointer-events-none">
              {/* Radar Ping Rings */}
              <div className="relative flex items-center justify-center">
                <span className="absolute h-10 w-10 rounded-full bg-red-500/40 animate-ping" />
                <span className="absolute h-6 w-6 rounded-full bg-red-500/60 animate-pulse" />
                <div className="relative flex h-5 w-5 items-center justify-center rounded-full bg-red-600 border-2 border-white shadow-md shadow-red-600/80">
                  <div className="h-1.5 w-1.5 rounded-full bg-white" />
                </div>
              </div>

              {/* Pin Callout Badge */}
              <div className="mt-2.5 flex flex-col items-center">
                <div className="rounded-lg border border-red-500/80 bg-red-950/95 px-3 py-1.5 shadow-xl backdrop-blur-md text-center">
                  <span className="block text-xs font-bold text-white tracking-wide">
                    ● {assetId} — Suspected Fault
                  </span>
                  <span className="block text-[10px] font-mono text-red-300">
                    {assetName} · Zone {location.zone || 'B'}
                  </span>
                </div>
                {/* Pointer tip */}
                <div className="h-1.5 w-1.5 rotate-45 bg-red-950 border-r border-b border-red-500/80 -mt-1" />
              </div>
            </div>
          </div>

          {/* Floating Map Controls */}
          <div className="absolute top-4 right-4 z-30 flex flex-col gap-1.5 bg-[#0c1626]/90 border border-slate-700/80 p-1 rounded-xl backdrop-blur-md shadow-lg">
            <button
              onClick={handleZoomIn}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white transition-colors cursor-pointer"
              title="Zoom In"
              aria-label="Zoom In"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
            <button
              onClick={handleZoomOut}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white transition-colors cursor-pointer"
              title="Zoom Out"
              aria-label="Zoom Out"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <button
              onClick={handleReset}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white transition-colors cursor-pointer"
              title="Recenter Map"
              aria-label="Recenter Map"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
            <div className="h-[1px] bg-slate-800 my-0.5" />
            <button
              onClick={() => setLayerType((l) => (l === 'dark' ? 'grid' : 'dark'))}
              className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors cursor-pointer ${
                layerType === 'grid' ? 'bg-cyan-950 text-cyan-300' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
              title="Toggle Tactical Blueprint Layer"
              aria-label="Toggle Layer"
            >
              <Layers className="h-4 w-4" />
            </button>
          </div>

          {/* Floating Target HUD / Coordinate Telemetry */}
          <div className="absolute bottom-4 left-4 z-30 flex flex-wrap items-center gap-3 rounded-xl border border-slate-700/80 bg-[#091526]/90 px-3.5 py-2 text-[11px] font-mono backdrop-blur-md shadow-lg text-slate-300">
            <div>
              <span className="text-slate-500">LAT:</span>{' '}
              <span className="font-semibold text-cyan-300">{lat.toFixed(4)}° N</span>
            </div>
            <div className="hidden sm:inline text-slate-600">•</div>
            <div>
              <span className="text-slate-500">LNG:</span>{' '}
              <span className="font-semibold text-cyan-300">{lng.toFixed(4)}° E</span>
            </div>
            <div className="hidden sm:inline text-slate-600">•</div>
            <div>
              <span className="text-slate-500">ZOOM:</span>{' '}
              <span className="font-semibold text-slate-200">{zoom}x</span>
            </div>
            <div className="hidden md:inline text-slate-600">•</div>
            <div className="hidden md:inline">
              <span className="text-slate-500">DATUM:</span>{' '}
              <span className="text-slate-400">WGS84 / EPSG:4326</span>
            </div>
          </div>
        </div>

        {/* Modal Footer with External Navigation & Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 bg-[#091526]/95 px-5 py-3 text-xs font-mono">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopyCoords}
              className="h-8 border-slate-700 bg-slate-900/80 hover:bg-slate-800 text-slate-200 text-xs font-mono cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 mr-1.5 text-emerald-400" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5 mr-1.5 text-slate-400" />
                  Copy Coordinates
                </>
              )}
            </Button>

            <a
              href={osmUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-slate-400 hover:text-cyan-300 px-2 py-1 transition-colors"
            >
              <span>OpenStreetMap</span>
              <ExternalLink className="h-3 w-3" />
            </a>

            <a
              href={gmapsUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-slate-400 hover:text-cyan-300 px-2 py-1 transition-colors"
            >
              <span>Google Maps</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>

          <Button
            size="sm"
            onClick={onClose}
            className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-xs h-8 px-4 cursor-pointer"
          >
            Close Map
          </Button>
        </div>
      </div>
    </div>
  )
}
