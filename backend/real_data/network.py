"""L-Town supply-branch graph (BattLeDIM 2018 geometry).

The published L-Town network is fed by three supply anchors:
  - inlet pipe p227  (reservoir R1 -> n303, gravity branch)
  - inlet pipe p235  (reservoir R2 -> n336, gravity branch)
  - pump PUMP_1      (n54 -> tank T1, pumped district)

We build an undirected adjacency from the 905 pipes and BFS from each anchor.
Every node then belongs to the nearest anchor's supply branch (fewest hops).
This lets the impact view say which supply branch a cluster of sagging
pressure sensors sits on, WITHOUT inventing zone letters that are not in the
published benchmark data.

Geometry source: src/data/ltown_network.json — extracted from the official
KIOS L-TOWN v1.2 network file (see that file's meta block for provenance).
"""
from __future__ import annotations

import json
import math
from collections import deque
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Optional, Tuple

_DATA = Path(__file__).resolve().parent.parent / "data" / "real" / "ltown_network.json"

ANCHORS: Dict[str, str] = {
    "p227": "n303",   # gravity inlet branch 1 (meter p227)
    "p235": "n336",   # gravity inlet branch 2 (meter p235)
    "PUMP_1": "n54",  # pumped district (pump discharge node, tank T1 area)
}

ANCHOR_LABELS: Dict[str, str] = {
    "p227": "p227 inlet branch (gravity, reservoir R1)",
    "p235": "p235 inlet branch (gravity, reservoir R2)",
    "PUMP_1": "PUMP_1 pumped district (tank T1)",
}

# A few published pressure sensors (n1, n4, n31, n215) sit in subgraphs the
# pipe table does not connect to any supply anchor — report them honestly
# instead of guessing a branch.
UNASSIGNED = "unassigned"
ANCHOR_LABELS[UNASSIGNED] = "unassigned branch (sensor not hydraulically connected in the pipe table)"


@lru_cache(maxsize=1)
def _load() -> dict:
    with open(_DATA, "r", encoding="utf-8") as f:
        return json.load(f)


@lru_cache(maxsize=1)
def _branch_map() -> Dict[str, str]:
    """node id -> anchor key ('p227'|'p235'|'PUMP_1') of the nearest supply anchor."""
    lt = _load()
    adjacency: Dict[str, List[str]] = {}
    for pid, (a, b) in lt["pipe_map"].items():
        adjacency.setdefault(a, []).append(b)
        adjacency.setdefault(b, []).append(a)

    dist: Dict[str, Dict[str, int]] = {}
    for anchor_key, start in ANCHORS.items():
        d = {start: 0}
        q = deque([start])
        while q:
            cur = q.popleft()
            for nxt in adjacency.get(cur, []):
                if nxt not in d:
                    d[nxt] = d[cur] + 1
                    q.append(nxt)
        dist[anchor_key] = d

    branch: Dict[str, str] = {}
    for node in lt["coords"]:
        best_key, best_d = None, None
        for key, d in dist.items():
            v = d.get(node)
            if v is None:
                continue
            if best_d is None or v < best_d:
                best_key, best_d = key, v
        if best_key is not None:
            branch[node] = best_key
    return branch


def branch_of(node_id: str) -> Optional[str]:
    return _branch_map().get(node_id) or UNASSIGNED


def branch_label(anchor_key: str) -> str:
    return ANCHOR_LABELS.get(anchor_key, anchor_key)


def node_coord(node_id: str) -> Optional[Tuple[float, float]]:
    c = _load()["coords"].get(node_id)
    return (c[0], c[1]) if c else None


def centroid(nodes: List[str]) -> Optional[dict]:
    pts = [node_coord(n) for n in nodes]
    pts = [p for p in pts if p]
    if not pts:
        return None
    return {
        "x": round(sum(p[0] for p in pts) / len(pts), 1),
        "y": round(sum(p[1] for p in pts) / len(pts), 1),
        "n": len(pts),
    }


def hop_distance(a: str, b: str) -> Optional[int]:
    """Shortest pipe-hop distance between two nodes (BFS, cached per pair)."""
    lt = _load()
    adjacency = _adjacency_cache()
    if a not in lt["coords"] or b not in lt["coords"]:
        return None
    d = {a: 0}
    q = deque([a])
    while q:
        cur = q.popleft()
        if cur == b:
            return d[cur]
        for nxt in adjacency.get(cur, []):
            if nxt not in d:
                d[nxt] = d[cur] + 1
                q.append(nxt)
    return None


@lru_cache(maxsize=1)
def _adjacency_cache() -> Dict[str, Tuple[str, ...]]:
    lt = _load()
    adj: Dict[str, List[str]] = {}
    for pid, (a, b) in lt["pipe_map"].items():
        adj.setdefault(a, []).append(b)
        adj.setdefault(b, []).append(a)
    return {k: tuple(v) for k, v in adj.items()}


def localize_nearest_pipe(sensor_ids: List[str]) -> Optional[dict]:
    """For a cluster of sagging sensors, find the network pipe closest to their centroid (Euclidean on model coords)."""
    lt = _load()
    c = centroid(sensor_ids)
    if not c:
        return None
    best_id, best_d = None, None
    for p in lt["pipes"]:
        a = lt["coords"].get(p["a"])
        b = lt["coords"].get(p["b"])
        if not a or not b:
            continue
        mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        d = math.hypot(mx - c["x"], my - c["y"])
        if best_d is None or d < best_d:
            best_id, best_d = p["id"], d
    if best_id is None:
        return None
    return {"pipe": best_id, "dist_model_m": round(best_d, 1)}
