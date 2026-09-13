"""Centralized GIS asset location registry and resolver for HydraNexus.

Maps physical network assets to spatial coordinates (WGS84 lat/long) with
provenance metadata (demo_gis, utility_gis, real_network_metadata).

Enforces PRD Rule 8 (Unknown Location Handling):
- Never fabricates coordinates (no 0, 0 or random values).
- If unconfigured, explicitly returns configured=False and a descriptive message.
"""
from __future__ import annotations
from typing import Optional, Dict, Any

# Primary spatial asset registry for the distribution network
ASSET_GIS_REGISTRY: Dict[str, Dict[str, Any]] = {
    "reservoir": {
        "asset_id": "RES-1",
        "node_id": "reservoir",
        "asset_name": "Primary Storage Reservoir",
        "asset_type": "reservoir",
        "zone": None,
        "latitude": 22.5850,
        "longitude": 88.3450,
        "elevation_m": 42.0,
        "source": "demo_gis",
        "status": "nominal",
    },
    "n1": {
        "asset_id": "N1",
        "node_id": "n1",
        "asset_name": "Main Distribution Junction",
        "asset_type": "junction",
        "zone": None,
        "latitude": 22.5790,
        "longitude": 88.3540,
        "elevation_m": 35.5,
        "source": "demo_gis",
        "status": "nominal",
    },
    "n2": {
        "asset_id": "N2",
        "node_id": "n2",
        "asset_name": "Zone A Sub-district Node",
        "asset_type": "sub_district",
        "zone": "A",
        "latitude": 22.5820,
        "longitude": 88.3680,
        "elevation_m": 31.2,
        "source": "demo_gis",
        "status": "nominal",
    },
    "n3": {
        "asset_id": "N3",
        "node_id": "n3",
        "asset_name": "B2 Junction",
        "asset_type": "junction",
        "zone": "B",
        "latitude": 22.5726,
        "longitude": 88.3639,
        "elevation_m": 28.4,
        "source": "demo_gis",
        "status": "suspected_fault",
    },
    "n4": {
        "asset_id": "N4",
        "node_id": "n4",
        "asset_name": "B3 / Zone B High Density Node",
        "asset_type": "high_density",
        "zone": "B",
        "latitude": 22.5680,
        "longitude": 88.3750,
        "elevation_m": 25.1,
        "source": "demo_gis",
        "status": "nominal",
    },
    "n5": {
        "asset_id": "N5",
        "node_id": "n5",
        "asset_name": "Zone C Residential Feeder",
        "asset_type": "residential",
        "zone": "C",
        "latitude": 22.5750,
        "longitude": 88.3820,
        "elevation_m": 29.8,
        "source": "demo_gis",
        "status": "nominal",
    },
    "t1": {
        "asset_id": "T1",
        "node_id": "t1",
        "asset_name": "Tank Zone B",
        "asset_type": "storage_tank",
        "zone": "B",
        "latitude": 22.5650,
        "longitude": 88.3610,
        "elevation_m": 45.0,
        "source": "demo_gis",
        "status": "nominal",
    },
    "t2": {
        "asset_id": "T2",
        "node_id": "t2",
        "asset_name": "Tank Zone C",
        "asset_type": "storage_tank",
        "zone": "C",
        "latitude": 22.5795,
        "longitude": 88.3900,
        "elevation_m": 44.2,
        "source": "demo_gis",
        "status": "nominal",
    },
}

# Maps network pipeline segments to their primary monitoring / fault asset
SEGMENT_ASSET_MAP: Dict[str, str] = {
    "B2 → B3": "n3",
    "N1 → N2": "n2",
    "N1 → Zone C": "n5",
    "N1 → B2": "n3",
    "reservoir → n1": "n1",
    "B2 → Tank T1": "t1",
    "Zone C → Tank T2": "t2",
}


def get_asset_location(asset_or_node_id: str) -> Optional[Dict[str, Any]]:
    """Lookup asset GIS record by node_id (e.g. 'n3') or asset_id (e.g. 'N3')."""
    if not asset_or_node_id:
        return None
    k = str(asset_or_node_id).strip().lower()
    if k in ASSET_GIS_REGISTRY:
        return dict(ASSET_GIS_REGISTRY[k])
    for entry in ASSET_GIS_REGISTRY.values():
        if entry["asset_id"].lower() == k:
            return dict(entry)
    return None


def get_fault_location(segment: str, asset_hint: Optional[str] = None) -> Dict[str, Any]:
    """Resolve fault location metadata for a localized pipeline segment or asset.

    Returns structured GIS details if configured; otherwise returns an explicit
    unconfigured payload without fabricating coordinates.
    """
    node_id = asset_hint
    if not node_id and segment:
        node_id = SEGMENT_ASSET_MAP.get(segment)

    if node_id:
        record = get_asset_location(node_id)
        if record and record.get("latitude") is not None and record.get("longitude") is not None:
            return {
                "configured": True,
                "asset_id": record["asset_id"],
                "node_id": record["node_id"],
                "asset_name": record["asset_name"],
                "asset_type": record["asset_type"],
                "latitude": record["latitude"],
                "longitude": record["longitude"],
                "elevation_m": record.get("elevation_m"),
                "location_source": record["source"],
                "status": record.get("status", "suspected_fault"),
            }

    target_name = asset_hint or segment or "Unknown Asset"
    return {
        "configured": False,
        "asset_id": node_id or "UNCONFIGURED",
        "node_id": node_id or "unconfigured",
        "asset_name": target_name,
        "asset_type": "pipe_segment" if ("→" in target_name or target_name.startswith("p")) else "asset",
        "latitude": None,
        "longitude": None,
        "elevation_m": None,
        "location_source": None,
        "status": "unconfigured_gis",
        "message": "Location coordinates unavailable. GIS location data is not configured for this asset.",
    }
