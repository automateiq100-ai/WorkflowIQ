"""Telegram bot send/receive helpers + Supabase Storage upload."""
from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone
from functools import lru_cache

from telegram import Bot

from .supabase_client import supa

STORAGE_BUCKET = "practiceiq-docs"


@lru_cache(maxsize=1)
def _bot() -> Bot:
    token = os.environ["TELEGRAM_BOT_TOKEN"]
    return Bot(token=token)


async def send_text(chat_id: int, text: str) -> int:
    """Send a plain-text reply. Returns Telegram message_id."""
    msg = await _bot().send_message(chat_id=chat_id, text=text)
    return msg.message_id


async def send_document(
    chat_id: int, file_bytes: bytes, filename: str, caption: str | None = None
) -> int:
    msg = await _bot().send_document(
        chat_id=chat_id, document=file_bytes, filename=filename, caption=caption
    )
    return msg.message_id


async def download_file(file_id: str) -> bytes:
    file_obj = await _bot().get_file(file_id)
    arr = await file_obj.download_as_bytearray()
    return bytes(arr)


async def send_ca_notification(ca_chat_id: int, text: str) -> int:
    msg = await _bot().send_message(chat_id=ca_chat_id, text=text)
    return msg.message_id


# ---------- Storage ---------- #

def _safe_filename(filename: str) -> str:
    keep = []
    for ch in filename:
        if ch.isalnum() or ch in ("_", "-", "."):
            keep.append(ch)
        else:
            keep.append("_")
    out = "".join(keep)
    return out[:120] or "file"


async def upload_to_supabase_storage(
    *,
    firm_id: str,
    client_id: str,
    filing_period: str,
    doc_type: str,
    filename: str,
    file_bytes: bytes,
    content_type: str | None = None,
) -> str:
    """Upload to bucket `practiceiq-docs`. Returns the storage path.
    Path is firm-scoped so any member of the firm can download via signed URL.
    """
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    safe = _safe_filename(filename)
    path = f"{firm_id}/{client_id}/{filing_period}/{doc_type}/{ts}_{safe}"

    def _upload():
        opts = {"content-type": content_type} if content_type else {}
        return supa().storage.from_(STORAGE_BUCKET).upload(path, file_bytes, file_options=opts)

    await asyncio.to_thread(_upload)
    return path
