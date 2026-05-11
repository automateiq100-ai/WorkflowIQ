"""Gmail polling ingest.

For each connected CA (row in `practiceiq_gmail_credentials`):
  1. Refresh access token if needed.
  2. List new messages since `last_history_id` (or first run = last 30 days with attachments).
  3. For each message:
     - Match `from_email` to `practiceiq_client_emails.email` for that owner.
     - Insert/upsert `practiceiq_emails` row + embed snippet/body.
     - For each attachment in MIME allowlist + ≤ 50 MB:
         - Save to Storage and INSERT a `practiceiq_documents` row with source='email'.
         - If matched-client: update `practiceiq_document_status` and notify CA on completion.

This runs every 5 min via APScheduler (see `scheduler/followup_jobs.py`).
"""
from __future__ import annotations

import asyncio
import base64
import os
from datetime import date, datetime, timedelta, timezone
from email.utils import parseaddr
from typing import Any

import httpx
from loguru import logger

from tools import db_tools, search_tools, telegram_tools, extract_tools
from tools.supabase_client import supa

TOKEN_URL = "https://oauth2.googleapis.com/token"
GMAIL_API = "https://gmail.googleapis.com/gmail/v1"
MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024
INITIAL_LOOKBACK_DAYS = 30
MAX_MESSAGES_PER_POLL = 30  # cap to avoid huge first runs


# ---------- Token refresh ---------- #

async def _refresh_access_token(creds: dict) -> str | None:
    """Refresh and persist the access token if expired or missing."""
    expires_at = creds.get("access_token_expires_at")
    access = creds.get("access_token")
    if access and expires_at:
        try:
            exp = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
            if exp > datetime.now(timezone.utc) + timedelta(minutes=2):
                return access
        except Exception:
            pass

    client_id = os.environ.get("GMAIL_CLIENT_ID")
    client_secret = os.environ.get("GMAIL_CLIENT_SECRET")
    if not client_id or not client_secret:
        logger.warning("Gmail env vars missing; cannot refresh")
        return None

    body = {
        "client_id": client_id,
        "client_secret": client_secret,
        "refresh_token": creds["refresh_token"],
        "grant_type": "refresh_token",
    }
    async with httpx.AsyncClient(timeout=15.0) as http:
        r = await http.post(TOKEN_URL, data=body)
    if r.status_code >= 400:
        logger.warning(f"refresh_access_token failed: {r.status_code} {r.text[:200]}")
        return None
    j = r.json()
    new_access = j.get("access_token")
    expires_in = int(j.get("expires_in", 0))
    if not new_access:
        return None
    new_exp = (datetime.now(timezone.utc) + timedelta(seconds=expires_in)).isoformat()

    def _persist():
        return (
            supa()
            .table("practiceiq_gmail_credentials")
            .update({
                "access_token": new_access,
                "access_token_expires_at": new_exp,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })
            .eq("firm_id", creds["firm_id"])
            .execute()
        )

    await asyncio.to_thread(_persist)
    return new_access


# ---------- API helpers ---------- #

async def _api(http: httpx.AsyncClient, access_token: str, path: str, params: dict | None = None) -> dict:
    r = await http.get(
        f"{GMAIL_API}{path}",
        headers={"authorization": f"Bearer {access_token}"},
        params=params or {},
    )
    if r.status_code >= 400:
        logger.warning(f"Gmail API {path} -> {r.status_code} {r.text[:200]}")
        return {}
    return r.json()


# ---------- Poll one owner ---------- #

async def poll_firm(firm_id: str) -> int:
    """Returns count of NEW emails ingested."""
    def _load():
        return (
            supa()
            .table("practiceiq_gmail_credentials")
            .select("*")
            .eq("firm_id", firm_id)
            .limit(1)
            .execute()
        )

    res = await asyncio.to_thread(_load)
    rows = res.data or []
    if not rows:
        return 0
    creds = rows[0]
    access = await _refresh_access_token(creds)
    if not access:
        return 0

    # Build the list of message IDs to inspect.
    async with httpx.AsyncClient(timeout=20.0) as http:
        message_ids: list[str] = []
        if creds.get("last_history_id"):
            page_token = None
            while True:
                params: dict[str, Any] = {
                    "startHistoryId": creds["last_history_id"],
                    "historyTypes": "messageAdded",
                }
                if page_token:
                    params["pageToken"] = page_token
                hist = await _api(http, access, "/users/me/history", params)
                for h in hist.get("history", []):
                    for added in h.get("messagesAdded", []):
                        m = added.get("message") or {}
                        if "id" in m:
                            message_ids.append(m["id"])
                page_token = hist.get("nextPageToken")
                if not page_token or len(message_ids) >= MAX_MESSAGES_PER_POLL:
                    break
        else:
            after = (date.today() - timedelta(days=INITIAL_LOOKBACK_DAYS)).strftime("%Y/%m/%d")
            params = {"q": f"after:{after}", "maxResults": MAX_MESSAGES_PER_POLL}
            listing = await _api(http, access, "/users/me/messages", params)
            for m in listing.get("messages", []):
                if "id" in m:
                    message_ids.append(m["id"])

        # Dedupe
        seen: set[str] = set()
        message_ids = [m for m in message_ids if not (m in seen or seen.add(m))]

        new_count = 0
        latest_history_id = creds.get("last_history_id")

        # Build set of known client emails for matching.
        client_emails = await _load_client_emails(firm_id)

        for msg_id in message_ids[:MAX_MESSAGES_PER_POLL]:
            try:
                ingested = await _ingest_message(http, access, firm_id, msg_id, client_emails)
                if ingested:
                    new_count += 1
                    if ingested.get("history_id"):
                        latest_history_id = ingested["history_id"]
            except Exception as e:
                logger.warning(f"gmail ingest failed for msg {msg_id}: {e}")

        if latest_history_id and latest_history_id != creds.get("last_history_id"):
            def _save_history():
                return (
                    supa()
                    .table("practiceiq_gmail_credentials")
                    .update({"last_history_id": str(latest_history_id), "updated_at": datetime.now(timezone.utc).isoformat()})
                    .eq("firm_id", firm_id)
                    .execute()
                )
            await asyncio.to_thread(_save_history)

    return new_count


async def _load_client_emails(firm_id: str) -> dict[str, dict]:
    """Returns {lowercase email: {client_email_id, client_id}} for fast match."""
    def _q():
        return (
            supa()
            .table("practiceiq_client_emails")
            .select("id, email, client_id")
            .eq("firm_id", firm_id)
            .execute()
        )
    res = await asyncio.to_thread(_q)
    out: dict[str, dict] = {}
    for r in res.data or []:
        if r.get("email"):
            out[r["email"].strip().lower()] = {"client_email_id": r["id"], "client_id": r["client_id"]}
    return out


async def _ingest_message(
    http: httpx.AsyncClient,
    access_token: str,
    firm_id: str,
    msg_id: str,
    client_emails: dict[str, dict],
) -> dict | None:
    """Fetch + persist one message (idempotent via UNIQUE firm_id+gmail_message_id).
    Returns {"history_id": ...} if newly ingested, else None.
    """
    # Skip if we've already ingested this gmail_message_id for this owner.
    def _exists():
        return (
            supa()
            .table("practiceiq_emails")
            .select("id")
            .eq("firm_id", firm_id)
            .eq("gmail_message_id", msg_id)
            .limit(1)
            .execute()
        )

    existed = await asyncio.to_thread(_exists)
    if existed.data:
        return None

    full = await _api(http, access_token, f"/users/me/messages/{msg_id}", {"format": "full"})
    if not full:
        return None

    headers = {h["name"].lower(): h["value"] for h in (full.get("payload", {}).get("headers") or [])}
    from_raw = headers.get("from") or ""
    from_name, from_email = parseaddr(from_raw)
    from_email_lc = (from_email or "").strip().lower()
    subject = headers.get("subject") or ""
    to_emails = _parse_address_list(headers.get("to") or "")
    cc_emails = _parse_address_list(headers.get("cc") or "")
    snippet = full.get("snippet") or ""
    received_at = _internal_date(full.get("internalDate"))
    history_id = full.get("historyId")
    thread_id = full.get("threadId")

    body_plain = _extract_plain_body(full.get("payload") or {})
    attachments = _list_attachments(full.get("payload") or {})

    matched = client_emails.get(from_email_lc)
    client_id = matched["client_id"] if matched else None
    client_email_id = matched["client_email_id"] if matched else None

    embed_input = " ".join(filter(None, [subject, snippet, (body_plain or "")[:2000]]))
    embedding = await search_tools.embed_text(embed_input) if embed_input.strip() else None

    def _insert():
        return (
            supa()
            .table("practiceiq_emails")
            .insert({
                "firm_id": firm_id,
                "client_id": client_id,
                "client_email_id": client_email_id,
                "gmail_message_id": msg_id,
                "gmail_thread_id": thread_id,
                "from_email": from_email,
                "from_name": from_name or None,
                "to_emails": to_emails,
                "cc_emails": cc_emails,
                "subject": subject,
                "body_plain": body_plain,
                "snippet": snippet,
                "received_at": received_at,
                "has_attachments": bool(attachments),
                "embedding": embedding,
            })
            .execute()
        )

    inserted = await asyncio.to_thread(_insert)
    rows = inserted.data or []
    if not rows:
        return None
    email_id = rows[0]["id"]

    # Save attachments as documents (only for matched clients; unknown senders → email saved, no docs).
    if attachments and client_id:
        for att in attachments:
            try:
                await _save_attachment(http, access_token, firm_id, client_id, msg_id, email_id, att)
            except Exception as e:
                logger.warning(f"attachment save failed msg={msg_id} att={att.get('filename')}: {e}")

        # Notify CA if pending checklist hits zero for current period.
        period = datetime.now(timezone.utc).strftime("%Y-%m")
        remaining = await db_tools.get_pending_docs(client_id, period=period)
        if not remaining:
            ca_chat = await db_tools.get_ca_telegram_chat_id(firm_id)
            if ca_chat:
                client_row = await db_tools.get_client_by_id(client_id)
                client_name = (client_row or {}).get("name") or "Client"
                try:
                    await telegram_tools.send_ca_notification(
                        ca_chat,
                        f"✅ {client_name} ne saare documents bhej diye via email for period {period}.",
                    )
                except Exception:
                    pass

    return {"history_id": history_id}


def _parse_address_list(value: str) -> list[str]:
    if not value:
        return []
    out: list[str] = []
    for part in value.split(","):
        _, addr = parseaddr(part)
        if addr:
            out.append(addr.strip())
    return out


def _internal_date(internal_date: str | None) -> str | None:
    if not internal_date:
        return None
    try:
        ms = int(internal_date)
        return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat()
    except (ValueError, TypeError):
        return None


def _extract_plain_body(payload: dict) -> str | None:
    """Walk MIME parts; prefer text/plain, fall back to a stripped text/html."""
    plain: list[str] = []
    html: list[str] = []

    def walk(p: dict):
        mt = p.get("mimeType") or ""
        body = (p.get("body") or {})
        data = body.get("data")
        if mt == "text/plain" and data:
            plain.append(_decode_b64url(data))
        elif mt == "text/html" and data:
            html.append(_decode_b64url(data))
        for child in p.get("parts") or []:
            walk(child)

    walk(payload)
    if plain:
        return "\n".join(plain)[:50000]
    if html:
        # Crude HTML strip — avoids pulling another dep.
        import re
        joined = "\n".join(html)
        text = re.sub(r"<[^>]+>", " ", joined)
        text = re.sub(r"\s+", " ", text)
        return text.strip()[:50000] or None
    return None


def _list_attachments(payload: dict) -> list[dict]:
    """Returns [{filename, mimeType, body_size, attachmentId}, ...]"""
    out: list[dict] = []

    def walk(p: dict):
        filename = p.get("filename") or ""
        body = p.get("body") or {}
        att_id = body.get("attachmentId")
        if filename and att_id:
            out.append({
                "filename": filename,
                "mimeType": p.get("mimeType"),
                "body_size": body.get("size") or 0,
                "attachmentId": att_id,
            })
        for child in p.get("parts") or []:
            walk(child)

    walk(payload)
    return out


def _decode_b64url(data: str) -> str:
    try:
        raw = base64.urlsafe_b64decode(data + "==" * ((4 - len(data) % 4) % 4))
        return raw.decode("utf-8", errors="replace")
    except Exception:
        return ""


async def _save_attachment(
    http: httpx.AsyncClient,
    access_token: str,
    firm_id: str,
    client_id: str,
    gmail_message_id: str,
    email_id: str,
    att: dict,
):
    if att.get("body_size", 0) > MAX_ATTACHMENT_BYTES:
        logger.info(f"skipping oversized attachment {att.get('filename')} ({att.get('body_size')} bytes)")
        return
    if not extract_tools.is_allowed(att.get("mimeType")):
        logger.info(f"skipping disallowed mime {att.get('mimeType')} for {att.get('filename')}")
        return

    raw = await _api(
        http, access_token,
        f"/users/me/messages/{gmail_message_id}/attachments/{att['attachmentId']}",
    )
    data = raw.get("data")
    if not data:
        return
    file_bytes = base64.urlsafe_b64decode(data + "==" * ((4 - len(data) % 4) % 4))

    period = datetime.now(timezone.utc).strftime("%Y-%m")
    storage_path = await telegram_tools.upload_to_supabase_storage(
        firm_id=firm_id,
        client_id=client_id,
        filing_period=period,
        doc_type="email_attachment",
        filename=att["filename"],
        file_bytes=file_bytes,
        content_type=att.get("mimeType"),
    )

    text = extract_tools.extract_text(att["filename"], att.get("mimeType"), file_bytes)
    embed_input = " ".join(filter(None, [att["filename"], (text or "")[:2000]]))
    embedding = await search_tools.embed_text(embed_input) if embed_input.strip() else None

    retention = (date.today().replace(year=date.today().year + 1)).isoformat()

    def _insert():
        return (
            supa()
            .table("practiceiq_documents")
            .insert({
                "client_id": client_id,
                "firm_id": firm_id,
                "storage_path": storage_path,
                "filename": att["filename"],
                "mime_type": att.get("mimeType"),
                "size_bytes": len(file_bytes),
                "doc_type": None,  # email attachments aren't auto-classified in V1
                "filing_period": period,
                "ocr_text": text,
                "embedding": embedding,
                "source": "email",
                "source_ref": gmail_message_id,
                "source_email_id": email_id,
                "uploaded_by": "gmail",
                "status": "received",
                "retention_until": retention,
                "is_sensitive": False,
            })
            .execute()
        )

    await asyncio.to_thread(_insert)


# ---------- Public entry ---------- #

async def poll_all_firms() -> None:
    """Scheduler entrypoint — poll every connected CA."""
    def _list():
        return (
            supa()
            .table("practiceiq_gmail_credentials")
            .select("firm_id")
            .execute()
        )
    res = await asyncio.to_thread(_list)
    firms = [r["firm_id"] for r in (res.data or [])]
    if not firms:
        return
    total = 0
    for f in firms:
        try:
            total += await poll_firm(f)
        except Exception as e:
            logger.warning(f"gmail poll failed for owner={o}: {e}")
    if total:
        logger.info(f"gmail poll: ingested {total} new email(s) across {len(owners)} owner(s)")
