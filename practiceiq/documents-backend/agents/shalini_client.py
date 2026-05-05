"""Hinglish client-facing agent (Deepseek `deepseek-chat`).

Used for: consent prompts, replies to inbound texts, document acknowledgements,
and scheduled follow-ups. Always returns plain Hinglish text (no JSON, no tools).
"""
from __future__ import annotations

import os
from functools import lru_cache
from typing import Literal

from loguru import logger
from openai import AsyncOpenAI

from prompts.client_prompt import build_client_prompt, TriggerContext

DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1"
DEEPSEEK_MODEL = "deepseek-chat"


@lru_cache(maxsize=1)
def _deepseek() -> AsyncOpenAI:
    return AsyncOpenAI(
        api_key=os.environ["DEEPSEEK_API_KEY"],
        base_url=DEEPSEEK_BASE_URL,
    )


async def generate_client_message(
    *,
    client: dict,
    trigger_context: TriggerContext,
    pending_docs: list[dict] | None = None,
    received_docs: list[dict] | None = None,
    days_to_deadline: int | None = None,
    followup_number: int = 0,
    inbound_text: str | None = None,
) -> str:
    system, user = build_client_prompt(
        client=client,
        pending_docs=pending_docs,
        received_docs=received_docs,
        days_to_deadline=days_to_deadline,
        followup_number=followup_number,
        trigger_context=trigger_context,
        inbound_text=inbound_text,
    )

    try:
        resp = await _deepseek().chat.completions.create(
            model=DEEPSEEK_MODEL,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            temperature=0.5,
            max_tokens=300,
        )
        out = (resp.choices[0].message.content or "").strip()
        if not out:
            return _fallback(trigger_context)
        return out
    except Exception as e:
        logger.warning(f"Deepseek call failed ({trigger_context}): {e}")
        return _fallback(trigger_context)


def _fallback(ctx: Literal["client_message", "scheduled_followup", "consent_request", "document_received"]) -> str:
    """Static Hinglish fallback when the LLM is unavailable."""
    if ctx == "consent_request":
        return (
            "Namaste! Main Shalini hoon, aapke CA ki assistant. "
            "Documents ke reminders bhejne ke liye consent chahiye. "
            "Reply 'Haan' agree karne ke liye, 'Nahi' decline ke liye."
        )
    if ctx == "document_received":
        return "✅ Document mil gaya, dhanyavad."
    if ctx == "scheduled_followup":
        return "Reminder: kuch documents pending hain. Please bhej dijiye jaldi."
    return "Theek hai, dhanyavad. CA sir/madam will check kar denge."
