"""OpenAI embeddings + Supabase hybrid_search RPC wrappers.

`text-embedding-3-small` (1536-dim). Falls back to OPENAI_API_KEY_SECONDARY
on RateLimitError. Wraps both `hybrid_search` (over chat messages) and
`documents_hybrid_search` (over document ocr_text).
"""
from __future__ import annotations

import asyncio
import os
from functools import lru_cache
from typing import Optional

from loguru import logger
from openai import AsyncOpenAI, RateLimitError

from .supabase_client import supa

EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIM = 1536


@lru_cache(maxsize=1)
def _client_primary() -> AsyncOpenAI:
    return AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"])


@lru_cache(maxsize=1)
def _client_fallback() -> Optional[AsyncOpenAI]:
    key = os.environ.get("OPENAI_API_KEY_SECONDARY")
    return AsyncOpenAI(api_key=key) if key else None


async def embed_text(text: str) -> Optional[list[float]]:
    """Return a 1536-dim embedding for `text`. Falls back to secondary key on rate limits.
    Returns None if both clients fail or text is empty.
    """
    text = (text or "").strip()
    if not text:
        return None

    async def _embed(c: AsyncOpenAI) -> list[float]:
        resp = await c.embeddings.create(model=EMBEDDING_MODEL, input=text[:8000])
        return resp.data[0].embedding

    try:
        return await _embed(_client_primary())
    except RateLimitError:
        fb = _client_fallback()
        if fb is None:
            logger.warning("embed_text: rate limited and no fallback key set")
            return None
        try:
            return await _embed(fb)
        except Exception as e:
            logger.warning(f"embed_text fallback failed: {e}")
            return None
    except Exception as e:
        logger.warning(f"embed_text failed: {e}")
        return None


async def hybrid_search(
    *,
    client_id: str,
    query_text: str,
    doc_type: str | None = None,
    period: str | None = None,
    match_count: int = 5,
) -> list[dict]:
    """RRF over practiceiq_messages (vector + FTS)."""
    embedding = await embed_text(query_text)
    if embedding is None:
        return []

    def _q():
        return supa().rpc(
            "hybrid_search",
            {
                "p_client_id": client_id,
                "p_query_text": query_text,
                "p_query_embedding": embedding,
                "p_doc_type": doc_type,
                "p_period": period,
                "p_match_count": match_count,
            },
        ).execute()

    try:
        res = await asyncio.to_thread(_q)
    except Exception as e:
        logger.warning(f"hybrid_search rpc failed: {e}")
        return []
    return res.data or []


async def documents_hybrid_search(
    *,
    firm_id: str,
    query_text: str,
    client_id: str | None = None,
    doc_type: str | None = None,
    period: str | None = None,
    match_count: int = 5,
) -> list[dict]:
    """RRF over practiceiq_documents.ocr_text."""
    embedding = await embed_text(query_text)
    if embedding is None:
        return []

    def _q():
        return supa().rpc(
            "documents_hybrid_search",
            {
                "p_firm_id": firm_id,
                "p_query_text": query_text,
                "p_query_embedding": embedding,
                "p_client_id": client_id,
                "p_doc_type": doc_type,
                "p_period": period,
                "p_match_count": match_count,
            },
        ).execute()

    try:
        res = await asyncio.to_thread(_q)
    except Exception as e:
        logger.warning(f"documents_hybrid_search rpc failed: {e}")
        return []
    return res.data or []


async def emails_hybrid_search(
    *,
    firm_id: str,
    query_text: str,
    client_id: str | None = None,
    match_count: int = 5,
) -> list[dict]:
    """RRF over practiceiq_emails.body_plain (Phase B). Returns [] if RPC missing."""
    embedding = await embed_text(query_text)
    if embedding is None:
        return []

    def _q():
        return supa().rpc(
            "emails_hybrid_search",
            {
                "p_firm_id": firm_id,
                "p_query_text": query_text,
                "p_query_embedding": embedding,
                "p_client_id": client_id,
                "p_match_count": match_count,
            },
        ).execute()

    try:
        res = await asyncio.to_thread(_q)
    except Exception as e:
        # Phase B may not be deployed yet — degrade gracefully.
        logger.debug(f"emails_hybrid_search unavailable: {e}")
        return []
    return res.data or []
