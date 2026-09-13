"""Cross-signal relationships over a causal window.

Checks whether flow and pressure move together the way a physical fault would
move them (flow up + pressure down = leak-like coupling) or disagree the way
a lying transmitter would (pressure move alone = decoupled).
"""
from __future__ import annotations
import math


def pearson(xs: list[float], ys: list[float]) -> float:
    n = len(xs)
    if n < 2 or len(ys) != n:
        return 0.0
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    syy = sum((y - my) ** 2 for y in ys)
    if sxx <= 1e-12 or syy <= 1e-12:
        return 0.0
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / math.sqrt(sxx * syy)


def coupling_status(flow_deltas: list[float], pressure_deltas: list[float]) -> dict:
    """Label the joint movement of flow and pressure deltas."""
    f_up = sum(d for d in flow_deltas if d > 0)
    f_dn = sum(-d for d in flow_deltas if d < 0)
    p_up = sum(d for d in pressure_deltas if d > 0)
    p_dn = sum(-d for d in pressure_deltas if d < 0)
    corr = pearson(flow_deltas, pressure_deltas) if len(flow_deltas) >= 2 else 0.0
    flow_net = f_up - f_dn
    press_net = p_up - p_dn
    if flow_net > 0 and press_net < 0:
        label = "leak-like coupling"
        detail = "Flow rising while pressure falls — consistent with a physical breach."
    elif abs(flow_net) <= 1e-9 and abs(press_net) <= 1e-9:
        label = "coupled stable"
        detail = "Flow and pressure steady together — no joint movement."
    elif press_net < 0 <= flow_net or press_net > 0 >= flow_net:
        label = "decoupled pressure move"
        detail = "Pressure moving without matching flow — transmitter disagreement, sensor-like."
    else:
        label = "mixed movement"
        detail = "Flow and pressure moving without a classic fault signature."
    return {"label": label, "detail": detail, "correlation": round(corr, 3),
            "flow_net": round(flow_net, 2), "pressure_net": round(press_net, 4)}
