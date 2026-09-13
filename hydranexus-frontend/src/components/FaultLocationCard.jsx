import { MapPin, AlertCircle, Compass, ExternalLink } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from './ui/card'
import { Badge } from './ui/badge'
import { Button } from './ui/button'

export default function FaultLocationCard({
  location,
  active = false,
  onViewMap,
  compact = false,
  title = 'Fault Location',
}) {
  if (!location) return null

  const isConfigured = location.configured !== false && location.latitude != null && location.longitude != null
  const assetId = location.asset_id || 'N3'
  const assetName = location.asset_name || 'B2 Junction'
  const source = location.location_source || location.source || 'Demo GIS'

  return (
    <Card className="border-slate-800/90 bg-[#0c1626]/90 backdrop-blur-md shadow-lg shadow-black/20 hover:border-slate-700 transition-all">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-cyan-950/80 border border-cyan-800/80 text-cyan-400">
            <Compass className="h-4 w-4" />
          </div>
          <div>
            <CardTitle className="text-xs font-mono uppercase tracking-wider text-slate-400">
              {title}
            </CardTitle>
            <span className="text-sm font-bold text-white tracking-tight">
              {assetId} · {assetName}
            </span>
          </div>
        </div>
        {active ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-950/80 border border-red-700/80 px-2.5 py-0.5 text-[10px] font-mono font-semibold text-red-300">
            <span className="h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse" />
            SUSPECTED FAULT
          </span>
        ) : (
          <Badge variant="outline" className="text-[10px] font-mono text-slate-400 border-slate-700">
            MONITORED ASSET
          </Badge>
        )}
      </CardHeader>

      <CardContent className="space-y-3 pt-1">
        {isConfigured ? (
          <>
            <div className="grid grid-cols-3 gap-2 rounded-lg border border-slate-800/80 bg-slate-900/60 p-2.5 text-center font-mono">
              <div className="border-r border-slate-800/80 pr-2">
                <span className="block text-[10px] uppercase tracking-wider text-slate-400">Latitude</span>
                <span className="text-xs font-semibold text-cyan-300">
                  {Number(location.latitude).toFixed(4)}° N
                </span>
              </div>
              <div className="border-r border-slate-800/80 pr-2">
                <span className="block text-[10px] uppercase tracking-wider text-slate-400">Longitude</span>
                <span className="text-xs font-semibold text-cyan-300">
                  {Number(location.longitude).toFixed(4)}° E
                </span>
              </div>
              <div>
                <span className="block text-[10px] uppercase tracking-wider text-slate-400">Source</span>
                <span className="text-xs font-medium text-emerald-400">
                  {source}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-1 text-[11px] font-mono text-slate-400">
                <MapPin className="h-3.5 w-3.5 text-cyan-400" />
                <span>Zone {location.zone || 'B'} · {location.elevation_m ? `${location.elevation_m}m EL` : 'WGS84'}</span>
              </div>

              {onViewMap && (
                <Button
                  size="sm"
                  onClick={() => onViewMap(location)}
                  className="bg-cyan-600 hover:bg-cyan-500 text-white font-mono text-xs h-7 px-2.5 shadow-sm shadow-cyan-600/30 cursor-pointer"
                >
                  <MapPin className="h-3 w-3 mr-1" />
                  View on Map
                </Button>
              )}
            </div>
          </>
        ) : (
          <div className="rounded-lg border border-amber-800/40 bg-amber-950/20 p-3 text-xs font-mono text-amber-300/90 space-y-1">
            <div className="flex items-center gap-1.5 font-semibold text-amber-400">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span>Location coordinates unavailable</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              GIS location data is not configured for this asset.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
