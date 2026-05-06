"""FastAPI app + Telegram bot + APScheduler.

Endpoints:
  POST /api/shalini/query   — CA-facing agent. Body: {prompt, history?}. Header: X-Firm-Id.
  POST /telegram/webhook    — Telegram update receiver (only when TELEGRAM_MODE=webhook).
  GET  /health              — liveness.
"""
from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, Request
from loguru import logger
from telegram import Update
from telegram.ext import Application, ApplicationBuilder

# Load repo-root .env so child modules see env vars at import time.
_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO_ROOT = os.path.abspath(os.path.join(_HERE, "..", ".."))
load_dotenv(os.path.join(_REPO_ROOT, ".env"))

from agents.shalini_ca import query_shalini  # noqa: E402
from scheduler.followup_jobs import start_scheduler  # noqa: E402
from webhook.telegram_webhook import register_handlers  # noqa: E402


_telegram_app: Application | None = None
_polling_task: asyncio.Task | None = None


def _build_telegram_app() -> Application:
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    if not token:
        raise RuntimeError("TELEGRAM_BOT_TOKEN not set")
    app = ApplicationBuilder().token(token).build()
    register_handlers(app)
    return app


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _telegram_app, _polling_task
    mode = os.environ.get("TELEGRAM_MODE", "polling").lower()

    if os.environ.get("TELEGRAM_BOT_TOKEN"):
        _telegram_app = _build_telegram_app()
        await _telegram_app.initialize()
        await _telegram_app.start()
        if mode == "polling":
            await _telegram_app.updater.start_polling()
            logger.info("Telegram bot: polling started")
        else:
            logger.info("Telegram bot: webhook mode (no polling)")
    else:
        logger.warning("TELEGRAM_BOT_TOKEN missing — Telegram bot NOT started")

    try:
        start_scheduler()
    except Exception as e:
        logger.warning(f"scheduler failed to start: {e}")

    yield

    # Shutdown.
    if _telegram_app is not None:
        try:
            if _telegram_app.updater and _telegram_app.updater.running:
                await _telegram_app.updater.stop()
            await _telegram_app.stop()
            await _telegram_app.shutdown()
        except Exception as e:
            logger.warning(f"Telegram shutdown error: {e}")


app = FastAPI(title="PracticeIQ Documents Backend", lifespan=lifespan)


@app.get("/health")
async def health():
    return {"ok": True, "telegram_running": _telegram_app is not None}


@app.post("/api/shalini/query")
async def shalini_query(
    request: Request,
    x_firm_id: str | None = Header(default=None, alias="X-Firm-Id"),
):
    if not x_firm_id:
        raise HTTPException(status_code=400, detail="X-Firm-Id header required")
    body: dict[str, Any] = await request.json()

    # Accept either {messages: [{role, content}]} or {prompt, history}.
    if isinstance(body.get("messages"), list) and body["messages"]:
        convo = body["messages"]
    else:
        prompt = (body.get("prompt") or "").strip()
        history: list[dict] = body.get("history") or []
        if not prompt:
            raise HTTPException(status_code=400, detail="prompt or messages[] is required")
        convo = [*history, {"role": "user", "content": prompt}]

    result = await query_shalini(firm_id=x_firm_id, conversation_history=convo)
    return result


@app.post("/telegram/webhook")
async def telegram_webhook(request: Request):
    if _telegram_app is None:
        raise HTTPException(status_code=503, detail="bot not running")
    payload = await request.json()
    update = Update.de_json(payload, _telegram_app.bot)
    await _telegram_app.process_update(update)
    return {"ok": True}
