"""SMS dispatch — Phase 1 mock, Twilio-ready (Phase 2).

Phase 1 (no credentials): send_sms returns the exact message that WOULD be
delivered, marked mode="mock" — the whole workflow (dispatch, worker tap,
auto-resolve) is testable end-to-end with zero external accounts.

Phase 2 (set TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER env
vars): the same function delivers real SMS via Twilio and returns
mode="twilio" with the provider's message sid. Nothing else changes.
"""
from __future__ import annotations

import os
from typing import Any, Dict

import httpx


def send_sms(phone: str, message: str) -> Dict[str, Any]:
    sid = os.getenv("TWILIO_ACCOUNT_SID")
    token = os.getenv("TWILIO_AUTH_TOKEN")
    from_number = os.getenv("TWILIO_FROM_NUMBER")

    if sid and token and from_number:
        try:
            resp = httpx.post(
                f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json",
                data={"To": phone, "From": from_number, "Body": message},
                auth=(sid, token),
                timeout=20,
            )
            data = resp.json()
            if resp.status_code in (200, 201):
                return {
                    "mode": "twilio",
                    "to": phone,
                    "sid": data.get("sid"),
                    "status": data.get("status", "queued"),
                }
            return {
                "mode": "twilio_error",
                "to": phone,
                "error": data.get("message", f"HTTP {resp.status_code}"),
            }
        except Exception as e:
            return {"mode": "twilio_error", "to": phone, "error": str(e)}

    # Phase 1 mock: log and return the would-be message
    print(f"[sms:mock] -> {phone}: {message.splitlines()[0]}…")
    return {"mode": "mock", "to": phone, "note": "Mock SMS (Phase 1) — connect Twilio env vars for real delivery"}
