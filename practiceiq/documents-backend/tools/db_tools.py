"""Async Supabase wrappers used by Telegram + agent paths.

The supabase-py client is sync; we wrap calls in asyncio.to_thread to keep
the FastAPI event loop responsive.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any, Optional

from .supabase_client import supa


# ---------- helpers ---------- #

async def _run(fn, *args, **kwargs):
    return await asyncio.to_thread(fn, *args, **kwargs)


# ---------- Telegram identity ---------- #

async def get_telegram_account(chat_id: int) -> Optional[dict]:
    """Look up a known Telegram account by chat_id.

    Returns a dict with account + parent client info, or None for unknown chat_ids
    (which is the silent-reject signal for the bot).
    """
    def _q():
        return (
            supa()
            .table("practiceiq_client_telegram_accounts")
            .select(
                "id, client_id, owner_user_id, telegram_chat_id, telegram_username, "
                "telegram_first_name, label, consent_given, consent_at, is_primary, "
                "practiceiq_clients!inner(id, name, owner_user_id, followup_broadcast)"
            )
            .eq("telegram_chat_id", chat_id)
            .limit(1)
            .execute()
        )

    res = await _run(_q)
    rows = res.data or []
    if not rows:
        return None
    row = rows[0]
    parent = row.pop("practiceiq_clients")
    if isinstance(parent, list):
        parent = parent[0] if parent else {}
    return {
        "account_id": row["id"],
        "client_id": row["client_id"],
        "owner_user_id": row["owner_user_id"],
        "client_name": parent.get("name"),
        "followup_broadcast": parent.get("followup_broadcast", False),
        "telegram_chat_id": row["telegram_chat_id"],
        "telegram_username": row.get("telegram_username"),
        "telegram_first_name": row.get("telegram_first_name"),
        "label": row.get("label"),
        "consent_given": row.get("consent_given") or False,
        "is_primary": row.get("is_primary") or False,
    }


async def consume_telegram_invite(
    token: str, chat_id: int, username: str | None, first_name: str | None
) -> Optional[dict]:
    """Validate + consume an invite token, atomically inserting an account row.

    Returns the new account dict on success, None if invite is missing, expired,
    or already consumed.
    """
    now_iso = datetime.now(timezone.utc).isoformat()

    def _consume():
        client = supa()
        invite_res = (
            client.table("practiceiq_telegram_invites")
            .select("token, client_id, owner_user_id, label, expires_at, consumed_at")
            .eq("token", token)
            .limit(1)
            .execute()
        )
        rows = invite_res.data or []
        if not rows:
            return None
        inv = rows[0]
        if inv.get("consumed_at"):
            return None
        if inv["expires_at"] <= now_iso:
            return None

        # Best-effort race: try inserting account first; if chat_id already linked,
        # we still mark invite consumed but return None so caller treats as duplicate.
        try:
            account_res = (
                client.table("practiceiq_client_telegram_accounts")
                .insert({
                    "client_id": inv["client_id"],
                    "owner_user_id": inv["owner_user_id"],
                    "telegram_chat_id": chat_id,
                    "telegram_username": username,
                    "telegram_first_name": first_name,
                    "label": inv.get("label"),
                    "is_primary": False,
                })
                .execute()
            )
        except Exception:
            account_res = None

        client.table("practiceiq_telegram_invites").update({
            "consumed_at": now_iso,
            "consumed_by_chat_id": chat_id,
        }).eq("token", token).execute()

        if account_res is None or not (account_res.data or []):
            return None
        return account_res.data[0]

    row = await _run(_consume)
    if not row:
        return None
    return {
        "account_id": row["id"],
        "client_id": row["client_id"],
        "owner_user_id": row["owner_user_id"],
        "label": row.get("label"),
        "consent_given": False,
        "is_primary": False,
    }


async def set_consent(account_id: str, given: bool) -> None:
    now_iso = datetime.now(timezone.utc).isoformat() if given else None

    def _q():
        return (
            supa()
            .table("practiceiq_client_telegram_accounts")
            .update({"consent_given": given, "consent_at": now_iso})
            .eq("id", account_id)
            .execute()
        )

    await _run(_q)


async def list_consented_accounts(client_id: str) -> list[dict]:
    def _q():
        return (
            supa()
            .table("practiceiq_client_telegram_accounts")
            .select("id, telegram_chat_id, label, is_primary")
            .eq("client_id", client_id)
            .eq("consent_given", True)
            .execute()
        )

    res = await _run(_q)
    return res.data or []


async def get_primary_account(client_id: str) -> Optional[dict]:
    def _q():
        return (
            supa()
            .table("practiceiq_client_telegram_accounts")
            .select("id, telegram_chat_id, label, consent_given")
            .eq("client_id", client_id)
            .eq("is_primary", True)
            .limit(1)
            .execute()
        )

    res = await _run(_q)
    rows = res.data or []
    if not rows or not rows[0].get("consent_given"):
        return None
    return rows[0]


# ---------- Messages ---------- #

async def save_message(
    *,
    client_id: str,
    sender: str,            # 'client' | 'shalini'
    message_type: str,      # 'text' | 'document' | 'image' | 'system'
    raw_text: str | None = None,
    doc_type: str | None = None,
    period: str | None = None,
    document_id: str | None = None,
    external_message_id: str | None = None,
) -> str:
    def _q():
        return (
            supa()
            .table("practiceiq_messages")
            .insert({
                "client_id": client_id,
                "sender": sender,
                "message_type": message_type,
                "raw_text": raw_text,
                "doc_type": doc_type,
                "period": period,
                "document_id": document_id,
                "external_message_id": external_message_id,
            })
            .execute()
        )

    res = await _run(_q)
    return res.data[0]["id"]


async def update_message_embedding(message_id: str, embedding: list[float]) -> None:
    def _q():
        return (
            supa()
            .table("practiceiq_messages")
            .update({"embedding": embedding})
            .eq("id", message_id)
            .execute()
        )

    await _run(_q)


# ---------- Documents ---------- #

async def save_document(
    *,
    client_id: str,
    owner_user_id: str,
    storage_path: str,
    filename: str,
    mime_type: str | None,
    size_bytes: int | None,
    doc_type: str | None,
    filing_period: str | None,
    ocr_text: str | None,
    embedding: list[float] | None,
    source: str = "telegram",
    source_ref: str | None = None,
    source_telegram_account_id: str | None = None,
    uploaded_by: str = "shalini",
    retention_until: str | None = None,
) -> str:
    def _q():
        return (
            supa()
            .table("practiceiq_documents")
            .insert({
                "client_id": client_id,
                "owner_user_id": owner_user_id,
                "storage_path": storage_path,
                "filename": filename,
                "mime_type": mime_type,
                "size_bytes": size_bytes,
                "doc_type": doc_type,
                "filing_period": filing_period,
                "ocr_text": ocr_text,
                "embedding": embedding,
                "source": source,
                "source_ref": source_ref,
                "source_telegram_account_id": source_telegram_account_id,
                "uploaded_by": uploaded_by,
                "status": "received",
                "retention_until": retention_until,
                "is_sensitive": False,
            })
            .execute()
        )

    res = await _run(_q)
    return res.data[0]["id"]


async def update_document_status(
    *,
    client_id: str,
    doc_type: str,
    period: str | None,
    status: str,
    received_message_id: str | None = None,
) -> None:
    """Upsert (client_id, doc_type, period) → status."""
    payload: dict[str, Any] = {
        "client_id": client_id,
        "doc_type": doc_type,
        "period": period,
        "status": status,
    }
    if status == "received":
        payload["received_at"] = datetime.now(timezone.utc).isoformat()
        if received_message_id:
            payload["received_message_id"] = received_message_id

    def _q():
        return (
            supa()
            .table("practiceiq_document_status")
            .upsert(payload, on_conflict="client_id,doc_type,period")
            .execute()
        )

    await _run(_q)


async def get_pending_docs(client_id: str, period: str | None = None) -> list[dict]:
    """Pending checklist items with their status (default 'pending' if no status row)."""
    def _q_checklist():
        q = (
            supa()
            .table("practiceiq_document_checklist")
            .select("id, doc_type, label, deadline_date, followup_start_date, period")
            .eq("client_id", client_id)
        )
        if period:
            q = q.eq("period", period)
        return q.execute()

    def _q_status():
        q = (
            supa()
            .table("practiceiq_document_status")
            .select("doc_type, period, status, received_at")
            .eq("client_id", client_id)
        )
        if period:
            q = q.eq("period", period)
        return q.execute()

    checklist_res, status_res = await asyncio.gather(_run(_q_checklist), _run(_q_status))
    status_map = {(s["doc_type"], s.get("period")): s for s in (status_res.data or [])}
    out: list[dict] = []
    for item in checklist_res.data or []:
        st = status_map.get((item["doc_type"], item.get("period")))
        status = (st or {}).get("status", "pending")
        if status == "received":
            continue
        out.append({**item, "status": status})
    return out


async def get_received_docs(client_id: str, period: str | None = None) -> list[dict]:
    def _q():
        q = (
            supa()
            .table("practiceiq_documents")
            .select("id, doc_type, filing_period, filename, uploaded_at, source")
            .eq("client_id", client_id)
            .is_("deleted_at", "null")
        )
        if period:
            q = q.eq("filing_period", period)
        return q.order("uploaded_at", desc=True).execute()

    res = await _run(_q)
    return res.data or []


async def get_full_status(client_name_or_id: str, owner_user_id: str) -> dict | None:
    """Used by CA agent tool. Accepts either id or fuzzy name."""

    def _q_by_id():
        return (
            supa()
            .table("practiceiq_clients")
            .select("id, name, owner_user_id")
            .eq("id", client_name_or_id)
            .eq("owner_user_id", owner_user_id)
            .limit(1)
            .execute()
        )

    def _q_by_name():
        return (
            supa()
            .table("practiceiq_clients")
            .select("id, name, owner_user_id")
            .eq("owner_user_id", owner_user_id)
            .ilike("name", f"%{client_name_or_id}%")
            .limit(1)
            .execute()
        )

    # Try id first if it looks like a UUID, otherwise name lookup.
    is_uuid = len(client_name_or_id) == 36 and client_name_or_id.count("-") == 4
    res = await _run(_q_by_id if is_uuid else _q_by_name)
    rows = res.data or []
    if not rows:
        return None
    client = rows[0]
    pending = await get_pending_docs(client["id"])
    received = await get_received_docs(client["id"])
    return {
        "client_id": client["id"],
        "client_name": client["name"],
        "pending": pending,
        "received": received[:10],
    }


async def get_all_pending_clients(owner_user_id: str) -> list[dict]:
    """For CA digest + 'get_all_pending' tool."""
    def _q():
        return (
            supa()
            .table("practiceiq_clients")
            .select("id, name")
            .eq("owner_user_id", owner_user_id)
            .execute()
        )

    res = await _run(_q)
    out = []
    for c in res.data or []:
        pending = await get_pending_docs(c["id"])
        if pending:
            out.append({"client_id": c["id"], "client_name": c["name"], "pending": pending})
    return out


# ---------- Follow-ups ---------- #

async def get_followup_count(client_id: str, doc_type: str, period: str | None = None) -> int:
    def _q():
        q = (
            supa()
            .table("practiceiq_followup_log")
            .select("id", count="exact")
            .eq("client_id", client_id)
            .eq("doc_type", doc_type)
        )
        if period:
            q = q.eq("period", period)
        return q.execute()

    res = await _run(_q)
    return res.count or 0


async def followup_sent_today(client_id: str, doc_type: str, period: str | None = None) -> bool:
    today_iso = datetime.now(timezone.utc).date().isoformat()

    def _q():
        q = (
            supa()
            .table("practiceiq_followup_log")
            .select("id")
            .eq("client_id", client_id)
            .eq("doc_type", doc_type)
            .gte("sent_at", f"{today_iso}T00:00:00+00:00")
        )
        if period:
            q = q.eq("period", period)
        return q.limit(1).execute()

    res = await _run(_q)
    return bool(res.data)


async def log_followup(
    *,
    client_id: str,
    doc_type: str,
    period: str | None,
    urgency_level: str,
    message_text: str,
    external_message_id: str | None = None,
) -> str:
    def _q():
        return (
            supa()
            .table("practiceiq_followup_log")
            .insert({
                "client_id": client_id,
                "doc_type": doc_type,
                "period": period,
                "urgency_level": urgency_level,
                "message_text": message_text,
                "external_message_id": external_message_id,
            })
            .execute()
        )

    res = await _run(_q)
    return res.data[0]["id"]


# ---------- Settings ---------- #

async def get_ca_telegram_chat_id(owner_user_id: str) -> int | None:
    def _q():
        return (
            supa()
            .table("practiceiq_settings")
            .select("ca_telegram_chat_id")
            .eq("owner_user_id", owner_user_id)
            .limit(1)
            .execute()
        )

    res = await _run(_q)
    rows = res.data or []
    if not rows or not rows[0].get("ca_telegram_chat_id"):
        return None
    try:
        return int(rows[0]["ca_telegram_chat_id"])
    except (ValueError, TypeError):
        return None


# ---------- Backwards-compat shims (legacy stub signatures referenced elsewhere) ---------- #

async def get_client_by_telegram_id(chat_id: int) -> dict | None:
    """Legacy alias for get_telegram_account."""
    return await get_telegram_account(chat_id)


async def get_client_by_id(client_id: str) -> dict | None:
    def _q():
        return (
            supa()
            .table("practiceiq_clients")
            .select("id, name, owner_user_id, followup_broadcast")
            .eq("id", client_id)
            .limit(1)
            .execute()
        )
    res = await _run(_q)
    rows = res.data or []
    return rows[0] if rows else None


async def list_clients(owner_user_id: str) -> list[dict]:
    def _q():
        return (
            supa()
            .table("practiceiq_clients")
            .select("id, name")
            .eq("owner_user_id", owner_user_id)
            .execute()
        )
    res = await _run(_q)
    return res.data or []


async def mark_doc_received(client_id: str, doc_type: str, period: str | None, message_id: str) -> None:
    """Legacy name for the manual mark-received flow."""
    await update_document_status(
        client_id=client_id,
        doc_type=doc_type,
        period=period,
        status="received",
        received_message_id=message_id,
    )
