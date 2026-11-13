/**
 * LTownMap — the REAL L-Town network map (BattLeDIM 2018).
 *
 * Geometry is loaded from the official BattLeDIM network file (KIOS Research,
 * L-TOWN v1.2): 785 nodes with model coordinates, 905 pipes (42.6 km), all 33
 * SCADA pressure sensors, both inflow meters, the pump station and every
 * ground-truth leak pipe. Nothing here is fabricated — see src/data/
 * ltown_network.json for provenance.
 *
 * Coordinates are the network's native model coordinates (metres, schematic
 * layout). They are NOT georeferenced to a real city, so we render on a plain
 * coordinate plane (Leaflet CRS.Simple) instead of a map tile layer — an
 * honest GIS view of the benchmark network rather than a fake city map.
 */
import { useEffect, useMemo, useRef } from 'react'
import { MapContainer, Polyline, CircleMarker, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import ltown from '../data/ltown_network.json'

const { coords, pipes, pipe_map, pump_nodes, reservoirs, tanks, pumps, scada } = ltown

const PRESSURE_SENSORS = scada.pressure_sensors
const LEAK_PIPES = new Set(scada.leak_pipes)

// Network extent (model coordinates) — used for the deterministic initial view.
const ALL_COORDS = Object.values(coords)
const NETWORK_BOUNDS = [
  [Math.min(...ALL_COORDS.map((c) => c[1])), Math.min(...ALL_COORDS.map((c) => c[0]))],
  [Math.max(...ALL_COORDS.map((c) => c[1])), Math.max(...ALL_COORDS.map((c) => c[0]))],
]

function pipeSeg(id) {
  const ab = pipe_map[id]
  if (!ab || !coords[ab[0]] || !coords[ab[1]]) return null
  return [coords[ab[0]], coords[ab[1]]]
}

function pipeWeight(dia) {
  if (dia >= 400) return 2.6
  if (dia >= 250) return 1.8
  return 1.0
}

function FitBounds({ focus }) {
  const map = useMap()
  const mountedRef = useRef(false)
  const prevFocusRef = useRef(null)
  useEffect(() => {
    // First mount: ALWAYS show the whole network. The initial view must never
    // be a zoomed-in corner just because a focus target already exists.
    if (!mountedRef.current) {
      mountedRef.current = true
      prevFocusRef.current = focus
      const xs = Object.values(coords).map((c) => c[0])
      const ys = Object.values(coords).map((c) => c[1])
      map.fitBounds(
        [
          [Math.min(...ys), Math.min(...xs)],
          [Math.max(...ys), Math.max(...xs)],
        ],
        { padding: [14, 14] },
      )
      return
    }
    // Later focus changes (e.g. user selects another episode) fly the camera.
    if (focus && focus !== prevFocusRef.current) {
      prevFocusRef.current = focus
      const c = coords[focus]
      if (c) map.flyTo([c[1], c[0]], Math.max(map.getZoom(), 2), { duration: 0.8 })
    }
  }, [map, focus])
  return null
}

/**
 * props:
 *  - reactedSensor: node id currently reacting (argmin pressure z) — highlighted
 *  - activeLeaks:   array of leak pipe ids to outline (ground-truth overlay)
 *  - episodes:      [{pipe, reacted_sensor, detected}] — validation localization view
 *  - focus:         node id to fly the camera to
 *  - showAllSensors: render all 33 sensor markers (default true)
 *  - className / height styling handled by parent container
 */
export default function LTownMap({
  reactedSensor = null,
  activeLeaks = [],
  episodes = [],
  focus = null,
  showAllSensors = true,
  sensors = [],
  className = '',
}) {
  const activeLeakSet = useMemo(() => new Set(activeLeaks), [activeLeaks])
  const sensorSet = useMemo(() => new Set(sensors), [sensors])
  const episodeMap = useMemo(() => {
    const m = {}
    for (const e of episodes) if (e.reacted_sensor) m[e.pipe] = e
    return m
  }, [episodes])

  const highlightPipes = useMemo(() => {
    const s = new Set(activeLeakSet)
    for (const e of episodes) s.add(e.pipe)
    return s
  }, [activeLeakSet, episodes])

  const episodeLinks = useMemo(() => {
    const links = []
    for (const e of episodes) {
      const seg = pipeSeg(e.pipe)
      const c = coords[e.reacted_sensor]
      if (!seg || !c) continue
      const mid = [(seg[0][0] + seg[1][0]) / 2, (seg[0][1] + seg[1][1]) / 2]
      links.push({ id: e.pipe, from: [mid[1], mid[0]], to: [c[1], c[0]], detected: e.detected })
    }
    return links
  }, [episodes])

  return (
    <MapContainer
      crs={L.CRS.Simple}
      className={`ltown-map ${className}`}
      style={{ background: '#0a1220' }}
      attributionControl={false}
      minZoom={0}
      maxZoom={5}
      zoomSnap={0.25}
      bounds={NETWORK_BOUNDS}
      boundsOptions={{ padding: [14, 14] }}
      scrollWheelZoom
    >
      <FitBounds focus={focus} />

      {/* Network skeleton — 905 real pipes */}
      {pipes.map((p) => {
        const a = coords[p.a]
        const b = coords[p.b]
        if (!a || !b) return null
        const hl = highlightPipes.has(p.id)
        const isLeak = LEAK_PIPES.has(p.id)
        return (
          <Polyline
            key={p.id}
            positions={[[a[1], a[0]], [b[1], b[0]]]}
            pathOptions={{
              // Bright enough to read against the #0a1220 background — the old
              // #1e293b/#334155 skeleton was nearly invisible on dark mode.
              // Highlight (active leak / validation episode) is amber to match
              // the "ground-truth leak pipe" legend chips in the UI.
              color: hl ? '#fbbf24' : isLeak ? '#b45309' : p.dia >= 400 ? '#64748b' : p.dia >= 250 ? '#475569' : '#3b4d63',
              weight: hl ? 3.2 : pipeWeight(p.dia),
              opacity: hl ? 1 : isLeak ? 0.85 : 0.9,
            }}
          >
            <Tooltip className="ltip">
              <span className="font-semibold text-slate-100">{p.id}</span>
              <span className="text-slate-400">
                {' '}· {p.len.toFixed(0)} m · Ø{p.dia.toFixed(0)} mm
                {isLeak && <span className="text-amber-400"> · ground-truth leak pipe</span>}
                {activeLeakSet.has(p.id) && <span className="text-rose-400"> · ACTIVE LEAK</span>}
              </span>
            </Tooltip>
          </Polyline>
        )
      })}

      {/* Validation episode links: ground-truth pipe midpoint → localized sensor */}
      {episodeLinks.map((l) => (
        <Polyline
          key={`link-${l.id}`}
          positions={[l.from, l.to]}
          pathOptions={{
            color: l.detected ? '#34d399' : '#64748b',
            weight: 1.2,
            dashArray: '4 4',
            opacity: 0.8,
          }}
        />
      ))}

      {/* Reservoirs / tank / pump */}
      {reservoirs.map((id) =>
        coords[id] ? (
          <CircleMarker
            key={id}
            center={[coords[id][1], coords[id][0]]}
            radius={5}
            pathOptions={{ color: '#38bdf8', fillColor: '#0ea5e9', fillOpacity: 0.9, weight: 1.5 }}
          >
            <Tooltip className="ltip"><span className="font-semibold text-sky-300">{id}</span> <span className="text-slate-400">Reservoir (source)</span></Tooltip>
          </CircleMarker>
        ) : null,
      )}
      {tanks.map((id) =>
        coords[id] ? (
          <CircleMarker
            key={id}
            center={[coords[id][1], coords[id][0]]}
            radius={5}
            pathOptions={{ color: '#a78bfa', fillColor: '#8b5cf6', fillOpacity: 0.9, weight: 1.5 }}
          >
            <Tooltip className="ltip"><span className="font-semibold text-violet-300">{id}</span> <span className="text-slate-400">Storage tank</span></Tooltip>
          </CircleMarker>
        ) : null,
      )}
      {pumps.map((id) => {
        const n = pump_nodes[id]?.[0]
        const c = n ? coords[n] : null
        if (!c) return null
        return (
          <CircleMarker
            key={id}
            center={[c[1], c[0]]}
            radius={5}
            pathOptions={{ color: '#fbbf24', fillColor: '#f59e0b', fillOpacity: 0.9, weight: 1.5 }}
          >
            <Tooltip className="ltip"><span className="font-semibold text-amber-300">{id}</span> <span className="text-slate-400">Pump station ({n} → {pump_nodes[id][1]})</span></Tooltip>
          </CircleMarker>
        )
      })}

      {/* Inflow district meters (pipes p227 / p235) */}
      {scada.flow_meters.filter((id) => id !== 'PUMP_1').map((id) => {
        const seg = pipeSeg(id)
        if (!seg) return null
        return (
          <Polyline
            key={id}
            positions={[[seg[0][1], seg[0][0]], [seg[1][1], seg[1][0]]]}
            pathOptions={{ color: '#22d3ee', weight: 3.5, opacity: 0.95 }}
          >
            <Tooltip className="ltip" permanent>
              <span className="font-semibold text-cyan-300">{id}</span> <span className="text-slate-400">flow meter</span>
            </Tooltip>
          </Polyline>
        )
      })}

      {/* Pressure sensors */}
      {showAllSensors &&
        PRESSURE_SENSORS.map((id) => {
          const c = coords[id]
          if (!c) return null
          const isReacted = id === reactedSensor
          const isSag = sensorSet.has(id)
          const inEpisode = episodes.some((e) => e.reacted_sensor === id)
          return (
            <CircleMarker
              key={id}
              center={[c[1], c[0]]}
              radius={isReacted ? 6 : isSag ? 5 : 3}
              pathOptions={{
                color: isReacted ? '#f43f5e' : isSag ? '#fbbf24' : inEpisode ? '#34d399' : '#22d3ee',
                fillColor: isReacted ? '#f43f5e' : isSag ? '#fbbf24' : inEpisode ? '#34d399' : '#0891b2',
                fillOpacity: isReacted || isSag ? 1 : 0.75,
                weight: isReacted ? 2 : isSag ? 1.5 : 1,
              }}
            >
              <Tooltip className="ltip">
                <span className="font-semibold text-slate-100">{id}</span>{' '}
                <span className="text-slate-400">pressure sensor</span>
                {isReacted && <span className="text-rose-400"> · REACTING (argmin z)</span>}
                {isSag && !isReacted && <span className="text-amber-400"> · SAGGING (below baseline)</span>}
              </Tooltip>
            </CircleMarker>
          )
        })}

      {/* Reacting sensor pulse ring */}
      {reactedSensor && coords[reactedSensor] && (
        <CircleMarker
          center={[coords[reactedSensor][1], coords[reactedSensor][0]]}
          radius={11}
          pathOptions={{ color: '#f43f5e', fillOpacity: 0, weight: 1.5, dashArray: '3 3' }}
        />
      )}
    </MapContainer>
  )
}
