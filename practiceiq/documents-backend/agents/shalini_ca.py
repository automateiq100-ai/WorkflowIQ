"""CA-facing agent (GPT-4o tool-calling loop).

Up to 5 tool-call iterations. Tools wrap db_tools + search_tools. The agent
returns a plain-text answer; tool results are not surfaced to the UI directly
(the model is responsible for synthesizing the answer).
"""
from __future__ import annotations

import json
import os
from functools import lru_cache
from typing import Any

from loguru import logger
from openai import AsyncOpenAI, RateLimitError

from prompts.ca_prompt import build_ca_prompt
from tools import db_tools, search_tools

CA_MODEL = "gpt-4o"
MAX_ITERATIONS = 5


@lru_cache(maxsize=1)
def _client_primary() -> AsyncOpenAI:
    return AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"])


@lru_cache(maxsize=1)
def _client_fallback() -> AsyncOpenAI | None:
    key = os.environ.get("OPENAI_API_KEY_SECONDARY")
    return AsyncOpenAI(api_key=key) if key else None


# ---------- Tool catalog ---------- #

def _tool_schemas() -> list[dict]:
    return [
        {
            "type": "function",
            "function": {
                "name": "get_client_status",
                "description": "Look up a client's pending and recently-received documents. Accepts a name (fuzzy) or UUID.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "client_name_or_id": {"type": "string", "description": "Partial name or UUID"},
                    },
                    "required": ["client_name_or_id"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "search_chat_history",
                "description": "Semantic search over Telegram chat history with a specific client.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "client_id": {"type": "string"},
                        "query": {"type": "string"},
                    },
                    "required": ["client_id", "query"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "search_doc_contents",
                "description": "Semantic search over the OCR/extracted text of uploaded documents.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string"},
                        "client_id": {"type": "string", "description": "Optional, narrows to one client"},
                    },
                    "required": ["query"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "search_email_history",
                "description": "Semantic search over emails received from clients (Gmail).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string"},
                        "client_id": {"type": "string", "description": "Optional, narrows to one client"},
                    },
                    "required": ["query"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_all_pending",
                "description": "List every client who currently has at least one pending document.",
                "parameters": {"type": "object", "properties": {}},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "send_reminder",
                "description": "Draft a reminder message for a client's pending doc. Returns draft text only — does NOT send.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "client_id": {"type": "string"},
                        "doc_type": {"type": "string"},
                    },
                    "required": ["client_id", "doc_type"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "mark_received_manually",
                "description": "Mark a doc as received (e.g. handed over offline). Use sparingly.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "client_id": {"type": "string"},
                        "doc_type": {"type": "string"},
                        "period": {"type": "string"},
                    },
                    "required": ["client_id", "doc_type", "period"],
                },
            },
        },
    ]


# ---------- Citation tracking ---------- #

def _summarize_for_citation(name: str, result: Any) -> list[dict]:
    """Convert a tool result into citation entries the UI can render."""
    out: list[dict] = []
    if name == "search_chat_history" and isinstance(result, list):
        for r in result[:3]:
            out.append({
                "kind": "chat",
                "label": (r.get("raw_text") or "")[:140],
                "when": r.get("timestamp"),
                "client_id": r.get("client_id"),
            })
    elif name == "search_doc_contents" and isinstance(result, list):
        for r in result[:3]:
            out.append({
                "kind": "document",
                "label": r.get("filename") or r.get("doc_type") or "doc",
                "when": r.get("uploaded_at"),
                "client_id": r.get("client_id"),
            })
    elif name == "search_email_history" and isinstance(result, list):
        for r in result[:3]:
            subj = r.get("subject") or "(no subject)"
            from_ = r.get("from_email") or ""
            out.append({
                "kind": "email",
                "label": f"{subj} — {from_}",
                "when": r.get("received_at"),
                "client_id": r.get("client_id"),
            })
    elif name == "get_client_status" and isinstance(result, dict) and result.get("client_id"):
        out.append({
            "kind": "client",
            "label": result.get("client_name") or "client",
            "when": None,
            "client_id": result.get("client_id"),
        })
    return out


# ---------- Tool dispatcher ---------- #

async def _dispatch(name: str, args: dict, owner_user_id: str) -> Any:
    if name == "get_client_status":
        return await db_tools.get_full_status(args["client_name_or_id"], owner_user_id)
    if name == "search_chat_history":
        return await search_tools.hybrid_search(
            client_id=args["client_id"], query_text=args["query"], match_count=5
        )
    if name == "search_doc_contents":
        return await search_tools.documents_hybrid_search(
            owner_user_id=owner_user_id,
            query_text=args["query"],
            client_id=args.get("client_id"),
            match_count=5,
        )
    if name == "search_email_history":
        return await search_tools.emails_hybrid_search(
            owner_user_id=owner_user_id,
            query_text=args["query"],
            client_id=args.get("client_id"),
            match_count=5,
        )
    if name == "get_all_pending":
        return await db_tools.get_all_pending_clients(owner_user_id)
    if name == "send_reminder":
        # Draft a reminder via the client agent but DO NOT send.
        from .shalini_client import generate_client_message
        client = await db_tools.get_client_by_id(args["client_id"])
        if not client:
            return {"error": "client not found"}
        if client.get("owner_user_id") != owner_user_id:
            return {"error": "not authorized"}
        pending = await db_tools.get_pending_docs(args["client_id"])
        draft = await generate_client_message(
            client=client,
            trigger_context="scheduled_followup",
            pending_docs=[p for p in pending if p["doc_type"] == args["doc_type"]],
            followup_number=0,
            days_to_deadline=3,
        )
        return {"draft": draft, "note": "review and send manually from the UI"}
    if name == "mark_received_manually":
        # Use a synthetic system message so the audit log exists.
        from datetime import datetime, timezone
        message_id = await db_tools.save_message(
            client_id=args["client_id"],
            sender="shalini",
            message_type="system",
            raw_text=f"Manually marked {args['doc_type']} ({args['period']}) as received by CA at {datetime.now(timezone.utc).isoformat()}",
            doc_type=args["doc_type"],
            period=args["period"],
        )
        await db_tools.update_document_status(
            client_id=args["client_id"],
            doc_type=args["doc_type"],
            period=args["period"],
            status="received",
            received_message_id=message_id,
        )
        return {"ok": True}
    return {"error": f"unknown tool {name}"}


# ---------- Main entry ---------- #

async def query_shalini(*, owner_user_id: str, conversation_history: list[dict]) -> dict:
    """Returns {"reply": str, "citations": [...]}.

    conversation_history is the OpenAI-format messages list [{role, content}, ...].
    The newest user turn is already appended by the caller.
    """
    system_prompt = build_ca_prompt({"firm_name": "your firm"})
    messages: list[dict] = [{"role": "system", "content": system_prompt}, *conversation_history]
    tools = _tool_schemas()
    citations: list[dict] = []

    for iteration in range(MAX_ITERATIONS):
        try:
            resp = await _call_openai(messages, tools)
        except RateLimitError:
            fb = _client_fallback()
            if fb is None:
                return {"reply": "Sorry, I'm rate-limited. Try again in a minute.", "citations": citations}
            resp = await fb.chat.completions.create(
                model=CA_MODEL, messages=messages, tools=tools, tool_choice="auto", temperature=0.3
            )
        except Exception as e:
            logger.warning(f"shalini_ca openai call failed: {e}")
            return {"reply": "Sorry, I hit an error. Please try again.", "citations": citations}

        choice = resp.choices[0]
        msg = choice.message
        tool_calls = getattr(msg, "tool_calls", None) or []

        if not tool_calls:
            return {"reply": (msg.content or "").strip(), "citations": citations}

        # Append assistant turn (with tool calls) so the next iter has full context.
        messages.append({
            "role": "assistant",
            "content": msg.content or "",
            "tool_calls": [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                }
                for tc in tool_calls
            ],
        })

        for tc in tool_calls:
            try:
                args = json.loads(tc.function.arguments or "{}")
            except json.JSONDecodeError:
                args = {}
            result = await _dispatch(tc.function.name, args, owner_user_id)
            citations.extend(_summarize_for_citation(tc.function.name, result))
            messages.append({
                "role": "tool",
                "tool_call_id": tc.id,
                "content": json.dumps(result, default=str),
            })

    logger.warning("shalini_ca: hit MAX_ITERATIONS without final answer")
    return {
        "reply": "I'm having trouble synthesizing an answer — try a more specific question.",
        "citations": citations,
    }


async def _call_openai(messages: list[dict], tools: list[dict]):
    return await _client_primary().chat.completions.create(
        model=CA_MODEL,
        messages=messages,
        tools=tools,
        tool_choice="auto",
        temperature=0.3,
    )
