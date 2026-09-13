"""Network topology for HydraNexus MVP.

Mirrors the frontend mock in `hydranexus-frontend/src/data.js`:
  reservoir -> n1 -> n2 (Zone A)
                n1 -> n3 (B2 junction)
                      n3 -> n4 (B3 / Zone B)
                      n3 -> t1 (Tank T1 · Zone B storage)
                n1 -> n5 (Zone C)
                      n5 -> t2 (Tank T2 · Zone C storage)

Uses NetworkX for graph queries (neighbors, paths, affected zones).
Software-first: no SCADA/GIS required; topology is code-defined.
"""
from __future__ import annotations
import networkx as nx

from .gis import get_fault_location, get_asset_location


def build_graph() -> nx.DiGraph:
    g = nx.DiGraph()
    nodes = [
        ("reservoir", {"label": "Reservoir", "type": "Source", "capacity": "120,000 m³", "pressure": "4.5 bar", "zone": None, "x": 40, "y": 180}),
        ("n1", {"label": "N1 · Main Junction", "type": "Distribution", "flow": "8,200 L/h", "pressure": "4.2 bar", "zone": None, "x": 260, "y": 180}),
        ("n2", {"label": "N2 · Zone A", "type": "Sub-district", "flow": "1,980 L/h", "pressure": "4.1 bar", "zone": "A", "x": 500, "y": 80}),
        ("n3", {"label": "N3 · B2 Junction", "type": "Arterial Feed", "flow": "3,060 L/h", "pressure": "3.9 bar", "zone": "B", "x": 500, "y": 280}),
        ("n4", {"label": "N4 · B3 / Zone B", "type": "High Density", "flow": "6,560 L/h", "pressure": "3.3 bar", "zone": "B", "x": 760, "y": 280}),
        ("n5", {"label": "N5 · Zone C", "type": "Residential", "flow": "2,140 L/h", "pressure": "3.9 bar", "zone": "C", "x": 760, "y": 80}),
        ("t1", {"label": "T1 · Tank Zone B", "type": "Storage Tank", "flow": "—", "pressure": "—", "level": "3.2 m", "zone": "B", "x": 500, "y": 420}),
        ("t2", {"label": "T2 · Tank Zone C", "type": "Storage Tank", "flow": "—", "pressure": "—", "level": "3.2 m", "zone": "C", "x": 980, "y": 80}),
    ]
    edges = [
        ("reservoir", "n1", {"id": "e1", "label": "reservoir → n1"}),
        ("n1", "n2", {"id": "e2", "label": "N1 → N2"}),
        ("n1", "n3", {"id": "e3", "label": "N1 → B2"}),
        ("n3", "n4", {"id": "e4", "label": "B2 → B3", "segment": "B2 → B3", "zone": "B"}),
        ("n1", "n5", {"id": "e5", "label": "N1 → Zone C"}),
        ("n3", "t1", {"id": "e6", "label": "B2 → Tank T1"}),
        ("n5", "t2", {"id": "e7", "label": "Zone C → Tank T2"}),
    ]
    g.add_nodes_from(nodes)
    for u, v, attrs in edges:
        g.add_edge(u, v, **attrs)
    return g


GRAPH = build_graph()

ZONES = [
    {"id": "A", "name": "Zone A", "demand": 1980, "pressure": 4.1, "status": "Normal", "users": 420, "baselineLoss": "0%"},
    {"id": "B", "name": "Zone B", "demand": 3060, "pressure": 3.3, "status": "Critical", "users": 560, "baselineLoss": "18.4%"},
    {"id": "C", "name": "Zone C", "demand": 2140, "pressure": 3.9, "status": "Normal", "users": 380, "baselineLoss": "1.2%"},
]

TANKS = [
    {"id": "t1", "name": "Tank T1 · Zone B", "zone": "B", "capacity": "50,000 L", "baselineLevel": 3.2, "feeder": "B2 Junction"},
    {"id": "t2", "name": "Tank T2 · Zone C", "zone": "C", "capacity": "35,000 L", "baselineLevel": 3.2, "feeder": "Zone C"},
]

# Segment metadata used for localization + impact.
SEGMENTS = {
    "B2 → B3": {"edge_id": "e4", "from": "n3", "to": "n4", "zone": "B", "users": 560, "localization_confidence": 81},
    "N1 → N2": {"edge_id": "e2", "from": "n1", "to": "n2", "zone": "A", "users": 420, "localization_confidence": 68},
    "N1 → Zone C": {"edge_id": "e5", "from": "n1", "to": "n5", "zone": "C", "users": 380, "localization_confidence": 66},
    "N1 → B2": {"edge_id": "e3", "from": "n1", "to": "n3", "zone": "B", "users": 560, "localization_confidence": 70},
}


def graph_payload(incident_active: bool = False):
    """Return frontend-compatible nodes/edges payload."""
    nodes = []
    for nid, attrs in GRAPH.nodes(data=True):
        loc = get_asset_location(nid) or {}
        data = {k: v for k, v in attrs.items() if k not in ("x", "y")}
        if loc:
            data.update({
                "asset_id": loc.get("asset_id"),
                "asset_name": loc.get("asset_name"),
                "asset_type": loc.get("asset_type"),
                "latitude": loc.get("latitude"),
                "longitude": loc.get("longitude"),
                "elevation_m": loc.get("elevation_m"),
                "location_source": loc.get("source"),
            })
        nodes.append({
            "id": nid,
            "position": {"x": attrs.get("x", 0), "y": attrs.get("y", 0)},
            "data": data,
            "type": "input" if nid == "reservoir" else "default",
        })
    edges = []
    for u, v, attrs in GRAPH.edges(data=True):
        edges.append({"id": attrs.get("id", f"{u}-{v}"), "source": u, "target": v, **attrs})
    return {"nodes": nodes, "edges": edges, "zones": ZONES, "tanks": TANKS, "segments": SEGMENTS, "incidentActive": incident_active}


def downstream_nodes(node_id: str) -> list[str]:
    if node_id not in GRAPH:
        return []
    return list(nx.descendants(GRAPH, node_id))


def affected_zone_for_segment(segment: str) -> str:
    return SEGMENTS.get(segment, {}).get("zone", "B")


def localize(flow_delta_pct: float, pressure_delta_pct: float, consumption_delta_pct: float, scenario_hint: str = "") -> dict:
    """Probable fault localization using topology + deviation pattern.

    MVP heuristic (transparent, explainable):
    - Large flow increase + pressure drop + stable consumption -> B2 → B3 (Zone B)
    - Very large flow + very large pressure drop -> B2 → B3 burst
    - Consumption increase -> Zone C feeder
    - Isolated single-point spike with stable pressure -> sensor at B2 junction
    - Small oscillation -> N1 junction
    """
    hint = (scenario_hint or "").lower()
    if hint in ("burst", "leak") or (flow_delta_pct > 20 and pressure_delta_pct < -10 and abs(consumption_delta_pct) < 12):
        seg = "B2 → B3"
    elif flow_delta_pct > 60 and pressure_delta_pct < -25:
        seg = "B2 → B3"
    elif consumption_delta_pct > 25:
        seg = "N1 → Zone C"
    elif abs(flow_delta_pct) > 30 and abs(pressure_delta_pct) < 4:
        seg = "N1 → B2"  # suspected sensor fault at B2 junction
    elif abs(flow_delta_pct) < 8 and abs(pressure_delta_pct) < 6:
        seg = "N1 → N2"
    else:
        seg = "B2 → B3"
    meta = SEGMENTS.get(seg, SEGMENTS["B2 → B3"])
    # Adjust confidence by evidence strength
    base = meta["localization_confidence"]
    strength = min(abs(flow_delta_pct) / 35.0, 1.0) * 0.6 + min(abs(pressure_delta_pct) / 18.0, 1.0) * 0.4
    confidence = int(max(45, min(96, base * (0.75 + 0.35 * strength))))
    gis_info = get_fault_location(seg)
    return {
        "segment": seg,
        "edge_id": meta["edge_id"],
        "zone": meta["zone"],
        "users": meta["users"],
        "confidence": confidence,
        "downstream": downstream_nodes(meta["from"]),
        "asset_id": gis_info.get("asset_id", "N3"),
        "asset_name": gis_info.get("asset_name", "B2 Junction"),
        "asset_type": gis_info.get("asset_type", "junction"),
        "latitude": gis_info.get("latitude"),
        "longitude": gis_info.get("longitude"),
        "elevation_m": gis_info.get("elevation_m"),
        "location_source": gis_info.get("location_source"),
        "gis_configured": gis_info.get("configured", False),
        "location_message": gis_info.get("message"),
    }
