/**
 * Centralized GIS Asset Registry & Spatial Location Model for HydraNexus.
 *
 * Provides physical geospatial coordinates (WGS84) and metadata for network assets.
 * Adheres to PRD Rule 8: Never fabricate coordinates for unconfigured assets.
 */

export const ASSET_GIS_REGISTRY = {
  reservoir: {
    asset_id: 'RES-1',
    node_id: 'reservoir',
    asset_name: 'Primary Storage Reservoir',
    asset_type: 'reservoir',
    zone: null,
    latitude: 22.585,
    longitude: 88.345,
    elevation_m: 42.0,
    source: 'Demo GIS',
    status: 'nominal',
  },
  n1: {
    asset_id: 'N1',
    node_id: 'n1',
    asset_name: 'Main Distribution Junction',
    asset_type: 'junction',
    zone: null,
    latitude: 22.579,
    longitude: 88.354,
    elevation_m: 35.5,
    source: 'Demo GIS',
    status: 'nominal',
  },
  n2: {
    asset_id: 'N2',
    node_id: 'n2',
    asset_name: 'Zone A Sub-district Node',
    asset_type: 'sub_district',
    zone: 'A',
    latitude: 22.582,
    longitude: 88.368,
    elevation_m: 31.2,
    source: 'Demo GIS',
    status: 'nominal',
  },
  n3: {
    asset_id: 'N3',
    node_id: 'n3',
    asset_name: 'B2 Junction',
    asset_type: 'junction',
    zone: 'B',
    latitude: 22.5726,
    longitude: 88.3639,
    elevation_m: 28.4,
    source: 'Demo GIS',
    status: 'suspected_fault',
  },
  n4: {
    asset_id: 'N4',
    node_id: 'n4',
    asset_name: 'B3 / Zone B High Density Node',
    asset_type: 'high_density',
    zone: 'B',
    latitude: 22.568,
    longitude: 88.375,
    elevation_m: 25.1,
    source: 'Demo GIS',
    status: 'nominal',
  },
  n5: {
    asset_id: 'N5',
    node_id: 'n5',
    asset_name: 'Zone C Residential Feeder',
    asset_type: 'residential',
    zone: 'C',
    latitude: 22.575,
    longitude: 88.382,
    elevation_m: 29.8,
    source: 'Demo GIS',
    status: 'nominal',
  },
  t1: {
    asset_id: 'T1',
    node_id: 't1',
    asset_name: 'Tank Zone B',
    asset_type: 'storage_tank',
    zone: 'B',
    latitude: 22.565,
    longitude: 88.361,
    elevation_m: 45.0,
    source: 'Demo GIS',
    status: 'nominal',
  },
  t2: {
    asset_id: 'T2',
    node_id: 't2',
    asset_name: 'Tank Zone C',
    asset_type: 'storage_tank',
    zone: 'C',
    latitude: 22.5795,
    longitude: 88.39,
    elevation_m: 44.2,
    source: 'Demo GIS',
    status: 'nominal',
  },
}

export const SEGMENT_ASSET_MAP = {
  'B2 → B3': 'n3',
  'N1 → N2': 'n2',
  'N1 → Zone C': 'n5',
  'N1 → B2': 'n3',
  'reservoir → n1': 'n1',
  'B2 → Tank T1': 't1',
  'Zone C → Tank T2': 't2',
}

/**
 * Retrieve GIS metadata for an asset by its node ID or asset ID.
 */
export function getAssetGIS(assetOrNodeId) {
  if (!assetOrNodeId) return null
  const key = String(assetOrNodeId).trim().toLowerCase()
  if (ASSET_GIS_REGISTRY[key]) {
    return { ...ASSET_GIS_REGISTRY[key] }
  }
  for (const entry of Object.values(ASSET_GIS_REGISTRY)) {
    if (entry.asset_id.toLowerCase() === key) {
      return { ...entry }
    }
  }
  return null
}

/**
 * Resolve GIS location metadata for a segment or fault hint.
 * If unconfigured, returns an explicit non-fabricated fallback.
 */
export function getFaultLocation(segment, assetHint = null) {
  let nodeId = assetHint
  if (!nodeId && segment) {
    nodeId = SEGMENT_ASSET_MAP[segment]
  }

  if (nodeId) {
    const record = getAssetGIS(nodeId)
    if (record && record.latitude != null && record.longitude != null) {
      return {
        configured: true,
        asset_id: record.asset_id,
        node_id: record.node_id,
        asset_name: record.asset_name,
        asset_type: record.asset_type,
        latitude: record.latitude,
        longitude: record.longitude,
        elevation_m: record.elevation_m,
        location_source: record.source,
        status: record.status || 'suspected_fault',
      }
    }
  }

  const targetName = assetHint || segment || 'Unknown Asset'
  return {
    configured: false,
    asset_id: nodeId || 'UNCONFIGURED',
    node_id: nodeId || 'unconfigured',
    asset_name: targetName,
    asset_type: targetName.includes('→') || targetName.startsWith('p') ? 'pipe_segment' : 'asset',
    latitude: null,
    longitude: null,
    elevation_m: null,
    location_source: null,
    status: 'unconfigured_gis',
    message: 'Location coordinates unavailable. GIS location data is not configured for this asset.',
  }
}
