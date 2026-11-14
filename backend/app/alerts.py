"""Field-alert workflow (demo mode, Phase 1).

Flow: a demo trigger creates an ALERT -> the operator picks a nearby field
worker -> an SMS is sent (mock in Phase 1; Twilio-ready behind env vars) ->
the worker taps the secure ack link -> the alert resolves itself and the
operator's screen (polling) drops it automatically.

Storage: Supabase tables `field_alerts` / `field_workers` when configured and
present, otherwise an in-memory mock (same pattern as incidents in db.py).
The worker tap must work from a phone hitting the public Render URL, so alert
state lives server-side — never only in the operator's browser.
"""
from __future__ import annotations

import secrets
import threading
from datetime import datetime
from typing import Any, Dict, List, Optional

from .db import client

_LOCK = threading.RLock()

# In-memory fallback store (used when Supabase is not configured / tables absent)
_MEMORY_ALERTS: Dict[str, Dict[str, Any]] = {}
_MEMORY_WORKERS: Dict[str, Dict[str, Any]] = {}

# Demo field crew (Phase 1 seed — editable via POST /api/workers)
_SEED_WORKERS = [
    {"id": "W1", "name": "Ramesh Kumar", "phone": "+919000000001", "zone": "Zone B", "specialty": "Pipe fitter"},
    {"id": "W2", "name": "Suresh Yadav", "phone": "+919000000002", "zone": "Zone B", "specialty": "Valve operator"},
    {"id": "W3", "name": "Anil Das", "phone": "+919000000003", "zone": "Zone A", "specialty": "Pump technician"},
    {"id": "W4", "name": "Priya Singh", "phone": "+919000000004", "zone": "Zone C", "specialty": "Leak detection"},
    {"id": "W5", "name": "Vikram Rao", "phone": "+919000000005", "zone": "Zone C", "specialty": "Pipe fitter"},
    {"id": "W6", "name": "Deepak Nair", "phone": "+919000000006", "zone": "Zone A", "specialty": "Field engineer"},
]


def _now() -> str:
    return datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S") + " UTC"


def _sb():
    """Supabase client if configured, else None."""
    try:
        return client()
    except Exception:
        return None


def _sb_ready(sb) -> bool:
    """True only when Supabase is configured AND the tables actually exist."""
    if sb is None:
        return False
    try:
        sb.table("field_alerts").select("id").limit(1).execute()
        return True
    except Exception:
        return False


for _w in _SEED_WORKERS:
    _MEMORY_WORKERS[_w["id"]] = dict(_w)


# ---------------------------------------------------------------------------
# workers
# ---------------------------------------------------------------------------

def list_workers() -> List[Dict[str, Any]]:
    sb = _sb()
    if _sb_ready(sb):
        try:
            rows = sb.table("field_workers").select("*").execute().data or []
            if rows:
                return rows
        except Exception:
            pass
    return list(_MEMORY_WORKERS.values())


def add_worker(payload: Dict[str, Any]) -> Dict[str, Any]:
    wid = payload.get("id") or f"W{secrets.token_hex(3)}"
    worker = {
        "id": wid,
        "name": str(payload.get("name") or "Unnamed"),
        "phone": str(payload.get("phone") or ""),
        "zone": str(payload.get("zone") or "Zone B"),
        "specialty": str(payload.get("specialty") or "Field crew"),
    }
    sb = _sb()
    if _sb_ready(sb):
        try:
            sb.table("field_workers").upsert(worker).execute()
        except Exception:
            pass
    with _LOCK:
        _MEMORY_WORKERS[wid] = worker
    return worker


# ---------------------------------------------------------------------------
# alerts
# ---------------------------------------------------------------------------

def create_alert(payload: Dict[str, Any]) -> Dict[str, Any]:
    aid = payload.get("id") or f"ALERT-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}-{secrets.token_hex(2).upper()}"
    alert = {
        "id": aid,
        "title": str(payload.get("title") or "Leak detected"),
        "type": str(payload.get("type") or "Leak"),
        "zone": str(payload.get("zone") or "Zone B"),
        "location": str(payload.get("location") or "B2 → B3"),
        "severity": str(payload.get("severity") or "HIGH"),
        "loss_per_hour": float(payload.get("lossPerHour") or 0),
        "details": payload.get("details") or [],
        "status": "ACTIVE",
        "worker_name": None,
        "worker_phone": None,
        "ack_token": None,
        "sms_preview": None,
        "created_at": _now(),
        "dispatched_at": None,
        "resolved_at": None,
        "resolve_reason": None,
    }
    sb = _sb()
    if _sb_ready(sb):
        try:
            sb.table("field_alerts").upsert(alert).execute()
        except Exception:
            pass
    with _LOCK:
        _MEMORY_ALERTS[aid] = alert
    return alert


def list_alerts() -> List[Dict[str, Any]]:
    sb = _sb()
    if _sb_ready(sb):
        try:
            rows = sb.table("field_alerts").select("*").order("created_at", desc=True).limit(50).execute().data
            if rows is not None:
                return rows
        except Exception:
            pass
    with _LOCK:
        rows = sorted(_MEMORY_ALERTS.values(), key=lambda a: a["created_at"], reverse=True)
    return rows


def _get_alert(alert_id: str) -> Optional[Dict[str, Any]]:
    sb = _sb()
    if _sb_ready(sb):
        try:
            rows = sb.table("field_alerts").select("*").eq("id", alert_id).execute().data
            if rows:
                return rows[0]
        except Exception:
            pass
    with _LOCK:
        return _MEMORY_ALERTS.get(alert_id)


def _save_alert(alert: Dict[str, Any]) -> None:
    sb = _sb()
    if _sb_ready(sb):
        try:
            sb.table("field_alerts").upsert(alert).execute()
        except Exception:
            pass
    with _LOCK:
        _MEMORY_ALERTS[alert["id"]] = alert


def dispatch_alert(alert_id: str, worker_id: str, ack_base: str = "") -> Dict[str, Any]:
    """Pick a worker -> build the SMS -> send it (mock in Phase 1) -> mark DISPATCHED."""
    alert = _get_alert(alert_id)
    if alert is None:
        raise ValueError(f"alert '{alert_id}' not found")
    if alert.get("status") == "RESOLVED":
        raise ValueError("alert already resolved")

    workers = {w["id"]: w for w in list_workers()}
    worker = workers.get(worker_id)
    if worker is None:
        raise ValueError(f"worker '{worker_id}' not found")

    token = secrets.token_hex(8)
    base = alert.get("location") or alert.get("zone") or ""
    message = (
        f"🚨 HydraNexus ALERT [{alert.get('severity')}]\n"
        f"{alert.get('type')} at {base} ({alert.get('zone')})\n"
        f"Est. loss: {float(alert.get('loss_per_hour') or 0):,.0f} L/hr\n"
        f"Tap to resolve: {ack_base.rstrip('/')}/api/alerts/{alert_id}/ack?t={token}"
    )

    from .sms import send_sms
    sms = send_sms(worker["phone"], message)

    alert.update({
        "status": "DISPATCHED",
        "worker_name": worker["name"],
        "worker_phone": worker["phone"],
        "ack_token": token,
        "sms_preview": message,
        "sms_mode": sms.get("mode", "mock"),
        "dispatched_at": _now(),
    })
    _save_alert(alert)
    return {**alert, "sms": sms}


def ack_alert(alert_id: str, token: str) -> Dict[str, Any]:
    """Field worker tapped the link -> resolve the alert."""
    alert = _get_alert(alert_id)
    if alert is None:
        raise ValueError(f"alert '{alert_id}' not found")
    expected = alert.get("ack_token")
    if not expected or not secrets.compare_digest(str(token), str(expected)):
        raise PermissionError("invalid acknowledgement token")
    if alert.get("status") != "RESOLVED":
        alert.update({
            "status": "RESOLVED",
            "resolved_at": _now(),
            "resolve_reason": f"Resolved by {alert.get('worker_name') or 'field crew'} via SMS link",
        })
        _save_alert(alert)
    return alert


def resolve_alert(alert_id: str, reason: str = "Resolved by operator") -> Dict[str, Any]:
    alert = _get_alert(alert_id)
    if alert is None:
        raise ValueError(f"alert '{alert_id}' not found")
    if alert.get("status") != "RESOLVED":
        alert.update({"status": "RESOLVED", "resolved_at": _now(), "resolve_reason": reason})
        _save_alert(alert)
    return alert


def auto_resolve_for_scenario_reset() -> int:
    """Operator switched the demo back to normal -> close outstanding alerts."""
    closed = 0
    for a in list_alerts():
        if a.get("status") in ("ACTIVE", "DISPATCHED"):
            resolve_alert(a["id"], "Operator returned the demo network to baseline")
            closed += 1
    return closed
