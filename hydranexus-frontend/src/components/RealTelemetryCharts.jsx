import { AreaChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { Card, CardHeader, CardTitle, CardContent } from './ui/card'

function MinimalTooltip({ active, payload, label, unit, baselineKey, baselineUnit }) {
  if (active && payload && payload.length) {
    const main = payload.find((p) => p.dataKey && !p.dataKey.endsWith('_red') && p.dataKey !== baselineKey) || payload[0]
    const base = payload.find((p) => p.dataKey === baselineKey)
    const red = payload.find((p) => p.dataKey && p.dataKey.endsWith('_red') && p.value != null)
    return (
      <div className="rounded-lg border border-slate-800 bg-[#0c1626]/95 backdrop-blur-md px-3 py-2 text-xs shadow-xl text-slate-100 font-mono">
        <div className="text-slate-400 text-[10px] uppercase tracking-wider">{label}</div>
        <div className={`font-semibold mt-0.5 ${red ? 'text-rose-400' : 'text-cyan-400'}`}>
          {Number(main.value).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 })}{' '}
          <span className="text-slate-400 font-normal">{unit}</span>
          {red && <span className="ml-1.5 text-[10px] font-bold text-rose-400">OUT OF RANGE</span>}
        </div>
        {base && base.value != null && (
          <div className="text-slate-500 text-[10px] mt-0.5">
            typical for this hour: {Number(base.value).toLocaleString(undefined, { maximumFractionDigits: 1 })} {baselineUnit || unit}
          </div>
        )}
      </div>
    )
  }
  return null
}

function RealChart({ title, unit, data, dataKey, color = '#0284c7', tag = 'SCADA Meter', alarms = [], steps = [], baselineKey, showRedOverlay = true }) {
  const gradId = `real-grad-${dataKey}`
  const redKey = `${dataKey}_red`

  // Merge the detector's per-step verdict (by timestamp) into the series so
  // each point knows whether the detector flagged it and what the hour-of-day
  // typical level was.
  const stepByTime = {}
  for (const s of steps) stepByTime[s.time] = s
  const enriched = data.map((d) => {
    const s = stepByTime[d.time]
    const flagged = s && (s.sustained || s.alarm)
    return {
      ...d,
      ...(baselineKey && s && s[baselineKey] != null ? { [baselineKey]: s[baselineKey] } : {}),
      [redKey]: showRedOverlay && flagged && d[dataKey] != null ? d[dataKey] : null,
    }
  })
  const redCount = enriched.filter((d) => d[redKey] != null).length

  return (
    <Card className="border-slate-800/80 bg-[#0c1626]/85 backdrop-blur-sm shadow-lg shadow-black/20 hover:border-cyan-500/30 transition-all duration-200">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <div className="flex items-center gap-2">
          <span className={`h-1.5 w-1.5 rounded-full animate-pulse ${redCount > 0 ? 'bg-rose-400' : 'bg-cyan-400'}`} />
          <CardTitle className="text-sm font-medium text-slate-200 tracking-tight">{title}</CardTitle>
        </div>
        <div className="flex items-center gap-1.5">
          {redCount > 0 && (
            <span
              className="text-[10px] font-mono text-rose-400 bg-rose-950/40 px-2 py-0.5 rounded border border-rose-500/30 uppercase tracking-wider"
              title="Readings outside the detector's hour-of-day normal envelope (red on the chart)"
            >
              {redCount} out of range
            </span>
          )}
          {alarms.length > 0 && (
            <span className="text-[10px] font-mono text-rose-400 bg-rose-950/40 px-2 py-0.5 rounded border border-rose-500/30 uppercase tracking-wider">
              alarm ×{alarms.length}
            </span>
          )}
          <span className="text-[10px] font-mono text-cyan-500/80 bg-cyan-950/40 px-2 py-0.5 rounded border border-cyan-500/20 uppercase tracking-wider">
            {tag}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-52 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={enriched} margin={{ top: 5, right: 5, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color} stopOpacity={0.4} />
                  <stop offset="95%" stopColor={color} stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id={`${gradId}-red`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#f43f5e" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(148, 163, 184, 0.08)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} width={50} />
              <Tooltip content={<MinimalTooltip unit={unit} baselineKey={baselineKey} />} />
              {/* Hour-of-day typical level (what "normal" means at this time) */}
              {baselineKey && (
                <Line
                  type="monotone"
                  dataKey={baselineKey}
                  stroke="#94a3b8"
                  strokeWidth={1.2}
                  strokeDasharray="5 4"
                  dot={false}
                  isAnimationActive={false}
                />
              )}
              <Area
                type="monotone"
                dataKey={dataKey}
                stroke={color}
                strokeWidth={2}
                fill={`url(#${gradId})`}
                isAnimationActive={true}
              />
              {/* Detector-flagged readings drawn in red on top of the series */}
              <Area
                type="monotone"
                dataKey={redKey}
                stroke="#f43f5e"
                strokeWidth={2.4}
                fill={`url(#${gradId}-red)`}
                connectNulls={false}
                dot={{ r: 2.2, fill: '#f43f5e', strokeWidth: 0 }}
                activeDot={{ r: 4, fill: '#f43f5e' }}
                isAnimationActive={false}
              />
              {/* Live detector alarms within the viewed window (rose dashed) */}
              {alarms.map((t) => (
                <ReferenceLine key={t} x={t} stroke="#f43f5e" strokeWidth={1.4} strokeDasharray="4 3" />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}

export default function RealTelemetryCharts({ data, alarms = [], steps = [] }) {
  if (!data || !data.length) return null

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-slate-500 font-mono">
        <span className="text-rose-400">Red</span> = reading outside the detector&apos;s hour-of-day normal envelope ·{' '}
        <span className="text-slate-400">dashed grey</span> = typical level for that hour of day ·{' '}
        <span className="text-rose-400/80">vertical dashes</span> = sustained alarm steps
      </p>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <RealChart
          title="Total Inflow"
          unit="m³/h"
          data={data}
          dataKey="flow"
          color="#0284c7"
          tag="p227 + p235 + PUMP"
          alarms={alarms}
          steps={steps}
          baselineKey="flow_typical"
        />
        <RealChart
          title="Network Pressure Head"
          unit="m"
          data={data}
          dataKey="pressure"
          color="#06b6d4"
          tag="33-Sensor Avg"
          alarms={alarms}
          steps={steps}
          baselineKey="press_typical"
        />
        <RealChart
          title="PUMP_1 Discharge"
          unit="m³/h"
          data={data}
          dataKey="pump_flow"
          color="#3b82f6"
          tag="L-Town Pump"
          alarms={alarms}
          steps={steps}
        />
        <RealChart
          title="Ground-Truth Leak Rate"
          unit="m³/h"
          data={data}
          dataKey="leak_rate"
          color="#ef4444"
          tag="Physical Leak Loss (answer key)"
          alarms={alarms}
          showRedOverlay={false}
        />
      </div>
    </div>
  )
}
