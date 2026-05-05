"""Telegram bot handlers — /start, text, document/photo, voice/audio.

Guard rails:
- `require_known_account()` returns None for unknown chat_ids → handlers silently drop.
- Document/photo handlers require consent_given=True.
- Voice/audio replies "V2 mein aayega" with no transcription.
"""
from __future__ import annotations

import json
import os
from datetime import date, datetime, timezone
from typing import Optional

from loguru import logger
from openai import AsyncOpenAI
from telegram import Update
from telegram.ext import (
    Application,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

from agents.shalini_client import generate_client_message
from tools import db_tools, search_tools, telegram_tools, extract_tools

CLASSIFIER_MODEL = "gpt-4o-mini"
MAX_DOC_BYTES = 50 * 1024 * 1024  # 50 MB

_oa: AsyncOpenAI | None = None


def _openai() -> AsyncOpenAI:
    global _oa
    if _oa is None:
        _oa = AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"])
    return _oa


def _now_period() -> str:
    """V1 default filing period: current calendar month YYYY-MM."""
    return datetime.now(timezone.utc).strftime("%Y-%m")


def _retention_until() -> str:
    """1-year retention from today."""
    today = date.today()
    return today.replace(year=today.year + 1).isoformat()


# ---------- Auth gate ---------- #

async def require_known_account(update: Update) -> Optional[dict]:
    chat = update.effective_chat
    if chat is None:
        return None
    account = await db_tools.get_telegram_account(chat.id)
    if account is None:
        logger.info(f"unknown_chat_id_blocked chat_id={chat.id}")
        return None
    return account


# ---------- /start ---------- #

async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat = update.effective_chat
    user = update.effective_user
    if chat is None or user is None:
        return

    # /start invite_<token> path.
    args = context.args or []
    if args and args[0].startswith("invite_"):
        token = args[0][len("invite_"):]
        account = await db_tools.consume_telegram_invite(
            token=token,
            chat_id=chat.id,
            username=user.username,
            first_name=user.first_name,
        )
        if account is None:
            logger.info(f"invite_invalid chat_id={chat.id} token_prefix={token[:8]}")
            return  # silent reject
        # Fall through to consent flow.
        full = await db_tools.get_telegram_account(chat.id)
        if full is None:
            return
        await _send_consent_request(full)
        return

    # Bare /start — must already be a known account.
    account = await require_known_account(update)
    if account is None:
        return

    if account["consent_given"]:
        msg = "Namaste! Aap already register hain. Documents bhej sakte hain ya pending list ke liye 'pending' likhiye."
        ext_id = await telegram_tools.send_text(account["telegram_chat_id"], msg)
        await db_tools.save_message(
            client_id=account["client_id"], sender="shalini",
            message_type="text", raw_text=msg, external_message_id=str(ext_id),
        )
        return

    await _send_consent_request(account)


async def _send_consent_request(account: dict):
    msg = await generate_client_message(
        client={"name": account.get("client_name") or account.get("label") or "ji"},
        trigger_context="consent_request",
    )
    ext_id = await telegram_tools.send_text(account["telegram_chat_id"], msg)
    await db_tools.save_message(
        client_id=account["client_id"], sender="shalini",
        message_type="text", raw_text=msg, external_message_id=str(ext_id),
    )


# ---------- Text ---------- #

async def on_text(update: Update, context: ContextTypes.DEFAULT_TYPE):
    account = await require_known_account(update)
    if account is None:
        return
    text = (update.message.text or "").strip() if update.message else ""

    # Save inbound message + embed in background-ish (sequential is fine).
    msg_id = await db_tools.save_message(
        client_id=account["client_id"],
        sender="client",
        message_type="text",
        raw_text=text,
        external_message_id=str(update.message.message_id) if update.message else None,
    )
    embedding = await search_tools.embed_text(text)
    if embedding:
        await db_tools.update_message_embedding(msg_id, embedding)

    # Consent flow.
    if not account["consent_given"]:
        lower = text.lower()
        if any(w in lower for w in ("haan", "haa", "ok", "yes", "y", "sahi")):
            await db_tools.set_consent(account["account_id"], True)
            reply = "Theek hai, aapka consent record ho gaya. Documents bhejne ke liye file attach karke send kariye. ✅"
        elif any(w in lower for w in ("nahi", "nahin", "no", "stop")):
            await db_tools.set_consent(account["account_id"], False)
            reply = "Samjh gaya, aapka decline note kar liya. CA sir/madam aapse personally contact karenge."
        else:
            reply = "Pehle consent ke liye 'Haan' ya 'Nahi' likh dijiye please."
        ext_id = await telegram_tools.send_text(account["telegram_chat_id"], reply)
        await db_tools.save_message(
            client_id=account["client_id"], sender="shalini",
            message_type="text", raw_text=reply, external_message_id=str(ext_id),
        )
        return

    # Normal reply via Deepseek.
    pending = await db_tools.get_pending_docs(account["client_id"])
    received = await db_tools.get_received_docs(account["client_id"])
    reply = await generate_client_message(
        client={"name": account.get("client_name") or "ji"},
        trigger_context="client_message",
        pending_docs=pending,
        received_docs=received,
        inbound_text=text,
    )
    ext_id = await telegram_tools.send_text(account["telegram_chat_id"], reply)
    out_msg_id = await db_tools.save_message(
        client_id=account["client_id"], sender="shalini",
        message_type="text", raw_text=reply, external_message_id=str(ext_id),
    )
    out_embedding = await search_tools.embed_text(reply)
    if out_embedding:
        await db_tools.update_message_embedding(out_msg_id, out_embedding)


# ---------- Document / photo ---------- #

async def on_document(update: Update, context: ContextTypes.DEFAULT_TYPE):
    account = await require_known_account(update)
    if account is None:
        return
    if not account["consent_given"]:
        return  # silent — they haven't agreed yet

    msg = update.message
    if msg is None:
        return

    # Pull file metadata.
    if msg.document:
        tg_file_id = msg.document.file_id
        filename = msg.document.file_name or "file"
        mime_type = msg.document.mime_type
        size = msg.document.file_size or 0
    elif msg.photo:
        # Use the highest-res photo.
        photo = msg.photo[-1]
        tg_file_id = photo.file_id
        filename = f"photo_{msg.message_id}.jpg"
        mime_type = "image/jpeg"
        size = photo.file_size or 0
    else:
        return

    if size and size > MAX_DOC_BYTES:
        await telegram_tools.send_text(account["telegram_chat_id"], "File 50MB se badi hai, please chhoti file bhejein.")
        return
    if not extract_tools.is_allowed(mime_type):
        await telegram_tools.send_text(account["telegram_chat_id"], "Yeh file type allowed nahi hai. PDF/JPG/PNG/XLSX/CSV bhejein.")
        return

    caption = (msg.caption or "").strip()
    pending = await db_tools.get_pending_docs(account["client_id"])
    period = _now_period()
    doc_type = await classify_doc_type(filename=filename, caption=caption, pending=pending)

    # Download + upload.
    file_bytes = await telegram_tools.download_file(tg_file_id)
    storage_path = await telegram_tools.upload_to_supabase_storage(
        owner_user_id=account["owner_user_id"],
        client_id=account["client_id"],
        filing_period=period,
        doc_type=doc_type or "uncategorized",
        filename=filename,
        file_bytes=file_bytes,
        content_type=mime_type,
    )

    # Extract text + embed.
    text = extract_tools.extract_text(filename, mime_type, file_bytes)
    embed_input = " ".join(filter(None, [caption, filename, (text or "")[:2000]]))
    embedding = await search_tools.embed_text(embed_input) if embed_input.strip() else None

    document_id = await db_tools.save_document(
        client_id=account["client_id"],
        owner_user_id=account["owner_user_id"],
        storage_path=storage_path,
        filename=filename,
        mime_type=mime_type,
        size_bytes=size or len(file_bytes),
        doc_type=doc_type,
        filing_period=period,
        ocr_text=text,
        embedding=embedding,
        source="telegram",
        source_ref=str(msg.message_id),
        source_telegram_account_id=account["account_id"],
        retention_until=_retention_until(),
    )

    # Save the chat-side row (links to document_id).
    chat_msg_id = await db_tools.save_message(
        client_id=account["client_id"],
        sender="client",
        message_type="document",
        raw_text=caption or filename,
        doc_type=doc_type,
        period=period,
        document_id=document_id,
        external_message_id=str(msg.message_id),
    )

    if doc_type:
        await db_tools.update_document_status(
            client_id=account["client_id"],
            doc_type=doc_type,
            period=period,
            status="received",
            received_message_id=chat_msg_id,
        )

    # Reply with remaining pending.
    remaining = await db_tools.get_pending_docs(account["client_id"], period=period)
    reply = await generate_client_message(
        client={"name": account.get("client_name") or "ji"},
        trigger_context="document_received",
        pending_docs=remaining,
    )
    ext_id = await telegram_tools.send_text(account["telegram_chat_id"], reply)
    await db_tools.save_message(
        client_id=account["client_id"], sender="shalini",
        message_type="text", raw_text=reply, external_message_id=str(ext_id),
    )

    # Notify CA when checklist for this period is now empty.
    if not remaining:
        ca_chat = await db_tools.get_ca_telegram_chat_id(account["owner_user_id"])
        if ca_chat:
            client_name = account.get("client_name") or "Client"
            await telegram_tools.send_ca_notification(
                ca_chat,
                f"✅ {client_name} ne saare documents bhej diye for period {period}.",
            )


# ---------- Voice / audio ---------- #

async def on_voice(update: Update, context: ContextTypes.DEFAULT_TYPE):
    account = await require_known_account(update)
    if account is None:
        return
    reply = "Voice notes V2 mein aayega — abhi text ya document bhejein please."
    ext_id = await telegram_tools.send_text(account["telegram_chat_id"], reply)
    await db_tools.save_message(
        client_id=account["client_id"], sender="shalini",
        message_type="text", raw_text=reply, external_message_id=str(ext_id),
    )


# ---------- Doc type classifier ---------- #

async def classify_doc_type(*, filename: str, caption: str, pending: list[dict]) -> str | None:
    """Use GPT-4o-mini to pick the best doc_type from the pending checklist.

    Returns None if no pending types or classifier abstains.
    """
    if not pending:
        return None
    options = [{"doc_type": p["doc_type"], "label": p.get("label") or p["doc_type"]} for p in pending]
    sys = (
        "You classify a Telegram document into one of the client's pending document types. "
        "Return STRICT JSON: {\"doc_type\": \"<one of the options>\"} or {\"doc_type\": null} if you can't tell."
    )
    user = (
        f"Filename: {filename}\nCaption: {caption}\n"
        f"Options: {json.dumps(options)}"
    )
    try:
        resp = await _openai().chat.completions.create(
            model=CLASSIFIER_MODEL,
            messages=[
                {"role": "system", "content": sys},
                {"role": "user", "content": user},
            ],
            temperature=0.0,
            response_format={"type": "json_object"},
        )
        raw = resp.choices[0].message.content or "{}"
        parsed = json.loads(raw)
        chosen = parsed.get("doc_type")
        valid = {p["doc_type"] for p in pending}
        if chosen in valid:
            return chosen
    except Exception as e:
        logger.warning(f"doc classify failed: {e}")
    return None


# ---------- Registration ---------- #

def register_handlers(application: Application) -> None:
    application.add_handler(CommandHandler("start", cmd_start))
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, on_text))
    application.add_handler(
        MessageHandler(filters.Document.ALL | filters.PHOTO, on_document)
    )
    application.add_handler(MessageHandler(filters.VOICE | filters.AUDIO, on_voice))
