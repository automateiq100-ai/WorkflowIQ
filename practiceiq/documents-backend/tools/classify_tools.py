"""Shared GPT-4o-mini document classifier — used by both Telegram and email ingest paths.

Returns a dict with:
  - doc_type: one of the pending option values, or None
  - confidence: 0.0–1.0
  - suggested_period: a period string from the pending list, or None

The classifier never raises; on any failure it returns the safe default
{"doc_type": None, "confidence": 0.0, "suggested_period": None}.

Logging is metadata-only — never include filename, caption, or body content
in log lines (per the privacy contract documented in CLAUDE.md).
"""
from __future__ import annotations

import json
import os
import time
from functools import lru_cache
from typing import Optional

from loguru import logger
from openai import AsyncOpenAI, RateLimitError

CLASSIFIER_MODEL = "gpt-4o-mini"

_SYSTEM_PROMPT = """You classify an inbound document (from Telegram or email) into one of the client's pending document types.

You will be given:
- A filename
- An optional caption (Telegram) or email subject + body snippet (email)
- The list of pending document types this client owes their CA, with periods

Return STRICT JSON in this exact shape:
{
  "doc_type": "<one of the options>" | null,
  "confidence": <float 0.0 to 1.0>,
  "suggested_period": "<YYYY-MM or YYYY-Q1/Q2/Q3/Q4 from the pending list>" | null
}

Rules:
- doc_type MUST be exactly one of the option values, or null. Never invent.
- If filename suggests a signature image (image001-099.png, signature.jpg, logo.png, anything looking like email branding), return doc_type=null with confidence=0.
- If filename/caption is too vague to tell, return doc_type=null with confidence below 0.5.
- confidence reflects how certain you are. >0.8 = clear match. 0.5-0.8 = probable. <0.5 = guessing.
- suggested_period: if subject/caption mentions a month/quarter, extract it. Must match a period in the pending list. Else null.
- Output ONLY the JSON object, no prose, no markdown.
"""

_SAFE_RETURN: dict = {"doc_type": None, "confidence": 0.0, "suggested_period": None}


@lru_cache(maxsize=1)
def _client_primary() -> AsyncOpenAI:
    return AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"])


@lru_cache(maxsize=1)
def _client_fallback() -> Optional[AsyncOpenAI]:
    key = os.environ.get("OPENAI_API_KEY_SECONDARY")
    return AsyncOpenAI(api_key=key) if key else None


async def classify_doc_type(
    *,
    filename: str,
    caption: str,
    pending: list[dict],
    body_text: Optional[str] = None,
) -> dict:
    """Classify a document into one of the client's pending doc_types.

    Args:
        filename: original filename of the attachment
        caption: Telegram caption OR email subject (passed by the caller)
        pending: list of dicts with at least `doc_type`; optionally `label`, `period`
        body_text: optional email body excerpt (first ~500 chars). None for Telegram.

    Returns:
        {"doc_type": str | None, "confidence": float, "suggested_period": str | None}
    """
    if not pending:
        return dict(_SAFE_RETURN)

    options = [
        {
            "doc_type": p["doc_type"],
            "label": p.get("label") or p["doc_type"],
            "period": p.get("period"),
        }
        for p in pending
        if p.get("doc_type")
    ]
    if not options:
        return dict(_SAFE_RETURN)

    valid_doc_types: set[str] = {o["doc_type"] for o in options}
    valid_periods: set[str] = {o["period"] for o in options if o.get("period")}

    user_payload = {
        "filename": filename,
        "caption_or_subject": caption,
        "body_excerpt": (body_text or "")[:500],
        "pending_options": options,
    }

    started = time.perf_counter()
    raw = await _call_classifier(json.dumps(user_payload))
    latency_ms = int((time.perf_counter() - started) * 1000)

    if raw is None:
        logger.info(f"classify_doc_type outcome=error latency_ms={latency_ms}")
        return dict(_SAFE_RETURN)

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning(f"classify_doc_type outcome=bad_json latency_ms={latency_ms}")
        return dict(_SAFE_RETURN)

    chosen = parsed.get("doc_type")
    confidence_raw = parsed.get("confidence", 0.0)
    suggested_period = parsed.get("suggested_period")

    # Clamp confidence to [0.0, 1.0].
    try:
        confidence = float(confidence_raw) if confidence_raw is not None else 0.0
    except (TypeError, ValueError):
        confidence = 0.0
    confidence = max(0.0, min(1.0, confidence))

    # Validate doc_type is one of the offered options.
    if chosen not in valid_doc_types:
        chosen = None

    # Validate suggested_period matches one of the pending periods.
    if suggested_period not in valid_periods:
        suggested_period = None

    outcome = "classified" if chosen else "abstained"
    logger.info(
        f"classify_doc_type outcome={outcome} doc_type={chosen} "
        f"confidence={confidence:.2f} latency_ms={latency_ms}"
    )

    return {
        "doc_type": chosen,
        "confidence": confidence,
        "suggested_period": suggested_period,
    }


async def _call_classifier(user_content: str) -> Optional[str]:
    """Call GPT-4o-mini in JSON-object mode. Returns raw response text or None on failure.

    Falls back to the secondary key on RateLimitError if configured.
    """
    async def _try(client: AsyncOpenAI) -> str:
        resp = await client.chat.completions.create(
            model=CLASSIFIER_MODEL,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": user_content},
            ],
            temperature=0.0,
            response_format={"type": "json_object"},
        )
        return resp.choices[0].message.content or "{}"

    try:
        return await _try(_client_primary())
    except RateLimitError:
        fb = _client_fallback()
        if fb is None:
            logger.warning("classify_doc_type rate-limited; no fallback key configured")
            return None
        try:
            return await _try(fb)
        except RateLimitError:
            logger.warning("classify_doc_type fallback also rate-limited")
            return None
        except Exception as e:
            logger.warning(f"classify_doc_type fallback failed: {type(e).__name__}")
            return None
    except Exception as e:
        logger.warning(f"classify_doc_type primary failed: {type(e).__name__}")
        return None
