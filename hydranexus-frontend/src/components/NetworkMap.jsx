import { useState } from 'react'
import { MapPin, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react'
import ReactFlow, { Background, Controls, MiniMap, Handle, Position } from 'reactflow'
import 'reactflow/dist/style.css'
import { networkEdges, networkNodes } from '../data'
import { getAssetGIS, getFaultLocation } from '../gis'

function getNodeIcon(label, type) {
  const l = (label || '').toLowerCase()
  const t = (type || '').toLowerCase()
  if (l.includes('reservoir') || t.includes('source')) {
    return (
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-cyan-950/80 text-cyan-400 border border-cyan-800/80">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
        </svg>
      </div>
    )
  }
  if (l.includes('tank') || t.includes('tank')) {
    return (
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-950/80 text-blue-400 border border-blue-800/80">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <rect x="5" y="4" width="14" height="16" rx="3" />
          <path strokeLinecap="round" d="M5 9h14M5 15h14" />
        </svg>
      </div>
    )
  }
  if (l.includes('industrial') || l.includes('b3') || t.includes('demand')) {
    return (
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-950/80 text-indigo-400 border border-indigo-800/80">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
      </div>
    )
  }
  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sky-950/80 text-sky-400 border border-sky-800/80">
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    </div>
  )
}

function MinimalNode({ data, selected }) {
  const alert = data.alert
  const decay = data.decay
  const gis = data.gis

  return (
    <div
      className={`w-[210px] rounded-xl border p-3 shadow-lg transition-all duration-200 select-none ${
        alert
          ? decay
            ? 'border-orange-500 bg-orange-950/80 ring-2 ring-orange-500/40 text-slate-100'
            : 'border-red-500 bg-red-950/80 ring-2 ring-red-500/40 text-slate-100'
          : selected
          ? 'border-cyan-400 bg-[#12223a] ring-2 ring-cyan-500/40 text-slate-100'
          : 'border-slate-800 bg-[#0d1b2e] hover:border-cyan-500/60 text-slate-100'
      }`}
    >
      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !rounded-full !border-2 !border-[#091526] !bg-cyan-400 shadow-sm" />
      <div className="flex items-start gap-2.5">
        {getNodeIcon(data.label, data.type)}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1">
            <span className="truncate text-xs font-semibold text-slate-100 tracking-tight" title={data.label}>
              {data.label}
            </span>
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${
                alert
                  ? decay
                    ? 'bg-orange-400 animate-pulse'
                    : 'bg-red-400 animate-pulse'
                  : 'bg-emerald-400'
              }`}
            />
          </div>
          <div className="text-[10px] font-mono text-slate-400 tracking-wide uppercase mt-0.5">{data.type || 'Junction'}</div>
          <div className="mt-1 flex items-center justify-between border-t border-slate-800/80 pt-1 text-[11px] font-mono">
            <span className="text-cyan-400 font-medium">{data.flow || (data.capacity ? data.capacity : '—')}</span>
            <span className="text-slate-300">{data.pressure || (data.level ? `${data.level}` : '')}</span>
          </div>
          {gis && (
            <div className={`mt-1.5 flex items-center justify-between text-[9px] font-mono px-1.5 py-0.5 rounded border ${
              alert
                ? 'bg-red-950/90 border-red-700/80 text-red-200'
                : 'bg-slate-900/80 border-slate-800/80 text-cyan-300/90'
            }`}>
              <span className="flex items-center gap-1">
                <MapPin className="h-2.5 w-2.5 text-cyan-400 shrink-0" />
                <span>{gis.latitude.toFixed(4)}°, {gis.longitude.toFixed(4)}°</span>
              </span>
              {alert && <span className="font-bold text-red-400 ml-1">FAULT</span>}
            </div>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!h-3 !w-3 !rounded-full !border-2 !border-[#091526] !bg-cyan-400 shadow-sm" />
    </div>
  )
}

const nodeTypes = { hydraulic: MinimalNode, default: MinimalNode, input: MinimalNode }

function EmbeddedGISView({ location, incidentActive, onViewMap }) {
  const [zoom, setZoom] = useState(15)
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [tileError, setTileError] = useState(false)

  const lat = location?.latitude ?? 22.5726
  const lng = location?.longitude ?? 88.3639
  const assetId = location?.asset_id || 'N3'
  const assetName = location?.asset_name || 'B2 Junction'

  const handleMouseDown = (e) => {
    setIsDragging(true)
    setDragStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y })
  }
  const handleMouseMove = (e) => {
    if (!isDragging) return
    setPanOffset({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y })
  }
  const handleMouseUp = () => setIsDragging(false)

  const n = Math.pow(2, zoom)
  const tileX = Math.floor(((lng + 180) / 360) * n)
  const latRad = (lat * Math.PI) / 180
  const tileY = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n)

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
    <div
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      className={`relative h-full w-full overflow-hidden bg-[#060e1a] select-none ${
        isDragging ? 'cursor-grabbing' : 'cursor-grab'
      }`}
    >
      <div
        className="absolute inset-0 transition-transform duration-75"
        style={{ transform: `translate(${panOffset.x}px, ${panOffset.y}px)` }}
      >
        {!tileError && (
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
        )}

        {/* Blueprint Grid */}
        <div
          className="absolute inset-0 pointer-events-none opacity-25"
          style={{
            backgroundImage:
              'linear-gradient(to right, #0ea5e9 1px, transparent 1px), linear-gradient(to bottom, #0ea5e9 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }}
        />

        {/* Range rings */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
          <div className="h-44 w-44 rounded-full border border-cyan-500/20" />
          <div className="absolute inset-0 -m-16 h-76 w-76 rounded-full border border-cyan-500/15" />
          <div className="absolute inset-0 -m-32 h-[420px] w-[420px] rounded-full border border-cyan-500/10" />
        </div>

        {/* Reticle */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
          <div className="absolute -left-12 top-0 h-[1px] w-24 bg-cyan-500/40" />
          <div className="absolute left-0 -top-12 h-24 w-[1px] bg-cyan-500/40" />
        </div>

        {/* Suspected Fault Beacon Marker */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20 flex flex-col items-center pointer-events-none">
          <div className="relative flex items-center justify-center">
            <span className="absolute h-10 w-10 rounded-full bg-red-500/40 animate-ping" />
            <span className="absolute h-6 w-6 rounded-full bg-red-500/60 animate-pulse" />
            <div className="relative flex h-5 w-5 items-center justify-center rounded-full bg-red-600 border-2 border-white shadow-md shadow-red-600/80">
              <div className="h-1.5 w-1.5 rounded-full bg-white" />
            </div>
          </div>
          <div className="mt-2 flex flex-col items-center">
            <div className="rounded-lg border border-red-500/80 bg-red-950/95 px-3 py-1.5 shadow-xl backdrop-blur-md text-center">
              <span className="block text-xs font-bold text-white tracking-wide">
                ● {assetId} — Suspected Fault
              </span>
              <span className="block text-[10px] font-mono text-red-300">
                {assetName} ({lat.toFixed(4)}° N, {lng.toFixed(4)}° E)
              </span>
            </div>
            <div className="h-1.5 w-1.5 rotate-45 bg-red-950 border-r border-b border-red-500/80 -mt-1" />
          </div>
        </div>
      </div>

      {/* Floating Zoom/Recenter Controls */}
      <div className="absolute top-14 right-3.5 z-30 flex flex-col gap-1 bg-[#0c1626]/90 border border-slate-700/80 p-1 rounded-xl backdrop-blur-md shadow-lg">
        <button
          onClick={() => setZoom((z) => Math.min(18, z + 1))}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white cursor-pointer"
          title="Zoom In"
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => setZoom((z) => Math.max(12, z - 1))}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white cursor-pointer"
          title="Zoom Out"
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => { setZoom(15); setPanOffset({ x: 0, y: 0 }) }}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white cursor-pointer"
          title="Recenter"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Floating HUD */}
      <div className="absolute bottom-3.5 left-3.5 z-30 flex items-center gap-3 rounded-xl border border-slate-700/80 bg-[#091526]/90 px-3 py-1.5 text-[11px] font-mono backdrop-blur-md shadow-lg text-slate-300">
        <div>
          <span className="text-slate-500">LAT:</span> <span className="font-semibold text-cyan-300">{lat.toFixed(4)}° N</span>
        </div>
        <div className="text-slate-600">•</div>
        <div>
          <span className="text-slate-500">LNG:</span> <span className="font-semibold text-cyan-300">{lng.toFixed(4)}° E</span>
        </div>
        <div className="text-slate-600">•</div>
        <div>
          <span className="text-slate-500">ZOOM:</span> <span className="font-semibold text-slate-200">{zoom}x</span>
        </div>
        {onViewMap && (
          <>
            <div className="text-slate-600">•</div>
            <button
              onClick={() => onViewMap(location)}
              className="text-cyan-400 hover:underline cursor-pointer flex items-center gap-1 font-semibold"
            >
              <span>Full Screen</span> ↗
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export default function NetworkMap({ incidentActive = false, compact = false, onSelectSegment, scenario = 'leak', onViewMap }) {
  const [viewMode, setViewMode] = useState('topology') // 'topology' | 'gis'
  const [activeNode, setActiveNode] = useState(null)
  const decay = scenario === 'corrosion'
  const suspectedSegment = scenario === 'demand' ? 'N1 → Zone C' : scenario === 'sensor' ? 'N1 → B2' : 'B2 → B3'
  const faultGis = getFaultLocation(suspectedSegment)

  const nodes = networkNodes.map((n) => ({
    ...n,
    type: 'hydraulic',
    data: {
      ...n.data,
      gis: getAssetGIS(n.id),
      alert: incidentActive && (n.data.label.includes('B2') || n.data.label.includes('B3') || n.data.label.includes('Tank')),
      decay: incidentActive && decay,
    },
  }))

  const edges = networkEdges.map((edge) => {
    const isIncidentEdge = incidentActive && edge.id === 'e4'
    const stroke = isIncidentEdge ? (decay ? '#f97316' : '#ef4444') : '#0284c7'
    return {
      ...edge,
      type: 'smoothstep',
      animated: isIncidentEdge,
      style: {
        stroke,
        strokeWidth: isIncidentEdge ? 2.5 : 1.5,
        opacity: isIncidentEdge ? 1 : 0.65,
      },
      label: isIncidentEdge ? (decay ? 'structural decay' : scenario === 'burst' ? 'confirmed burst' : 'suspected leak') : '',
      labelStyle: { fontSize: 10, fill: isIncidentEdge ? (decay ? '#fb923c' : '#f87171') : '#38bdf8', fontWeight: 600 },
    }
  })

  const nodeGis = activeNode ? getAssetGIS(activeNode.id) : null

  return (
    <div className={`relative ${compact ? 'h-[340px]' : 'h-[500px]'} overflow-hidden rounded-xl border border-slate-800/80 bg-[#091526]/90 backdrop-blur-xs shadow-inner`}>
      {/* Top Floating View Switcher & Fault Status Bar */}
      <div className="absolute top-3 left-3 z-30 flex flex-wrap items-center gap-2 pointer-events-auto">
        <div className="flex items-center rounded-lg border border-slate-700 bg-slate-900/95 p-0.5 shadow-lg backdrop-blur-md">
          <button
            onClick={() => setViewMode('topology')}
            className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs transition-all cursor-pointer ${
              viewMode === 'topology'
                ? 'bg-cyan-600 text-white shadow-xs font-semibold'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <span>⛶ Topology</span>
          </button>
          <button
            onClick={() => setViewMode('gis')}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-all cursor-pointer ${
              viewMode === 'gis'
                ? 'bg-cyan-600 text-white shadow-xs font-semibold'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <MapPin className="h-3 w-3" />
            <span>GIS Map View</span>
          </button>
        </div>

        {incidentActive && faultGis && (
          <div className="flex items-center gap-2 rounded-lg border border-red-800/80 bg-red-950/90 px-3 py-1 text-xs font-mono text-red-200 shadow-md backdrop-blur-md">
            <span className="h-2 w-2 rounded-full bg-red-400 animate-pulse" />
            <span>
              Fault: <strong>{faultGis.asset_id}</strong> ({faultGis.latitude.toFixed(4)}°, {faultGis.longitude.toFixed(4)}°)
            </span>
            {onViewMap && (
              <button
                onClick={() => onViewMap(faultGis)}
                className="ml-1 rounded bg-red-900/80 hover:bg-red-800 px-2 py-0.5 text-[10px] font-bold text-white transition-colors cursor-pointer"
                title="Open full-screen interactive GIS map"
              >
                Modal ↗
              </button>
            )}
          </div>
        )}
      </div>

      {viewMode === 'gis' ? (
        <EmbeddedGISView location={faultGis} incidentActive={incidentActive} onViewMap={onViewMap} />
      ) : (
        <>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodeClick={(_, node) => {
              setActiveNode(node)
              onSelectSegment?.('B2 → B3')
            }}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#1e3250" gap={24} size={1} />
            <Controls showInteractive={false} className="!border-slate-800 !bg-slate-900 !rounded-lg overflow-hidden" />
          </ReactFlow>

          {/* Floating Network Legend */}
          <div className="absolute bottom-3.5 right-3.5 z-10 flex items-center gap-3.5 rounded-full border border-slate-800 bg-slate-950/80 px-4 py-1.5 text-[11px] font-mono text-slate-300 shadow-md backdrop-blur-md">
            <div className="flex items-center gap-1.5">
              <span className="h-0.5 w-3.5 rounded-full bg-sky-500" />
              <span>Pipeline</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full border border-sky-400 bg-slate-900" />
              <span>Node</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              <span>Active</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-red-400" />
              <span>Incident</span>
            </div>
          </div>
        </>
      )}

      {activeNode && (
        <div className="absolute bottom-14 right-3.5 z-20 w-64 rounded-xl border border-slate-700 bg-slate-900/95 p-3.5 shadow-xl backdrop-blur-md">
          <div className="flex items-start justify-between gap-2">
            <div className="text-xs font-bold text-white">{activeNode.data.label}</div>
            <button
              onClick={() => setActiveNode(null)}
              className="rounded p-0.5 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
              aria-label="Close node details"
            >
              ×
            </button>
          </div>
          <dl className="mt-2 space-y-1 text-xs font-mono text-slate-400">
            <div className="flex justify-between">
              <dt>Type</dt>
              <dd className="text-slate-200">{activeNode.data.type || '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Pressure</dt>
              <dd className="text-sky-400 font-semibold">{activeNode.data.pressure || '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Flow</dt>
              <dd className="text-sky-400 font-semibold">{activeNode.data.flow || '—'}</dd>
            </div>
            {activeNode.data.level && (
              <div className="flex justify-between">
                <dt>Tank level</dt>
                <dd className="text-emerald-400 font-semibold">{activeNode.data.level}</dd>
              </div>
            )}
          </dl>

          {nodeGis && (
            <div className="mt-2.5 border-t border-slate-800/80 pt-2 text-[11px] font-mono">
              <div className="flex items-center justify-between text-slate-400">
                <span>Coordinates</span>
                <span className="text-cyan-300 font-semibold">
                  {nodeGis.latitude.toFixed(4)}°, {nodeGis.longitude.toFixed(4)}°
                </span>
              </div>
              <div className="flex items-center justify-between text-slate-400 mt-1">
                <span>Source</span>
                <span className="text-emerald-400">{nodeGis.source}</span>
              </div>
              {onViewMap && (
                <button
                  onClick={() => onViewMap(nodeGis)}
                  className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg bg-cyan-600/90 hover:bg-cyan-500 py-1.5 text-xs font-medium text-white shadow-xs transition-colors cursor-pointer"
                >
                  <MapPin className="h-3.5 w-3.5" />
                  <span>View on Map</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
