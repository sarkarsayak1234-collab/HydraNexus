import { useState } from 'react'
import { MapPin } from 'lucide-react'
import ReactFlow, { Background, Controls, MiniMap, Handle, Position } from 'reactflow'
import 'reactflow/dist/style.css'
import { networkEdges, networkNodes } from '../data'
import { getAssetGIS } from '../gis'

function getNodeIcon(label, type) {
  const l = (label || '').toLowerCase()
  const t = (type || '').toLowerCase()
  if (l.includes('reservoir') || t.includes('source')) {
    return (
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sky-950/80 text-sky-400 border border-sky-800/80">
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
          <div className="mt-1.5 flex items-center justify-between border-t border-slate-800/80 pt-1 text-[11px] font-mono">
            <span className="text-cyan-400 font-medium">{data.flow || (data.capacity ? data.capacity : '—')}</span>
            <span className="text-slate-300">{data.pressure || (data.level ? `${data.level}` : '')}</span>
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!h-3 !w-3 !rounded-full !border-2 !border-[#091526] !bg-cyan-400 shadow-sm" />
    </div>
  )
}

const nodeTypes = { hydraulic: MinimalNode, default: MinimalNode, input: MinimalNode }

export default function NetworkMap({ incidentActive = false, compact = false, onSelectSegment, scenario = 'leak', onViewMap }) {
  const [activeNode, setActiveNode] = useState(null)
  const decay = scenario === 'corrosion'

  const nodes = networkNodes.map((n) => ({
    ...n,
    type: 'hydraulic',
    data: {
      ...n.data,
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
