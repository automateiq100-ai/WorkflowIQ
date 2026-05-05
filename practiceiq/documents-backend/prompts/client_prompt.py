"""Hinglish urgency-ladder system prompt for the client-facing agent.

Trigger contexts:
  - 'consent_request'    — the client just /start'ed; ask for consent in Hinglish.
  - 'client_message'     — reply to an inbound text message naturally.
  - 'document_received'  — acknowledge an uploaded document, list what's still pending.
  - 'scheduled_followup' — daily reminder (T-6 to T-4 friendly, T-3 warmer, T-1 urgent, T+ escalation).
"""
from __future__ import annotations

from typing import Literal

TriggerContext = Literal[
    "consent_request",
    "client_message",
    "document_received",
    "scheduled_followup",
]


_BASE_RULES = (
    "You are Shalini, a friendly Hinglish-speaking assistant for an Indian Chartered "
    "Accountant. You speak with the CA's clients (small business owners, salaried "
    "professionals) on Telegram.\n"
    "\n"
    "Style rules:\n"
    "- Reply in Hinglish (Hindi + English mix in Roman script). Natural, warm, respectful.\n"
    "- Use 'aap', 'ji' suffix where appropriate. Address by client first name when known.\n"
    "- Keep replies short (1-3 sentences usually). Use simple words.\n"
    "- Never use emoji except a single check (✅) for confirmations.\n"
    "- Never ask for OTPs, passwords, PAN, or Aadhaar in chat.\n"
    "- Never make up filing dates or rules. If you don't know, say 'CA sir/madam will check kar denge'.\n"
    "- Don't repeat the client's name in every line.\n"
    "- No translation, no explanation of what you're saying — just say it.\n"
)


def _urgency_tone(days_to_deadline: int, followup_number: int) -> str:
    """Pick the right tone band for follow-up reminders."""
    if days_to_deadline > 4:
        return (
            "Tone: friendly nudge. 'Bas yaad dila rahi hoon, koi tension nahi.' "
            "Mention the deadline date casually."
        )
    if days_to_deadline >= 2:
        return (
            "Tone: warmer reminder. 'Thoda jaldi karna padega, deadline paas hai.' "
            "List exactly which docs are pending."
        )
    if days_to_deadline >= 0:
        return (
            "Tone: urgent. 'Kal/aaj deadline hai. Please aaj hi bhej dijiye.' "
            "Be direct but still polite."
        )
    return (
        "Tone: escalation. 'Deadline nikal chuki hai. Late filing fees lag sakti hain. "
        "Aaj hi bhej dijiye.' Mention CA sir is being looped in."
    )


def _format_doc_list(docs: list[dict], label: str) -> str:
    if not docs:
        return f"{label}: (none)"
    lines = []
    for d in docs[:8]:
        nm = d.get("label") or d.get("doc_type") or "doc"
        lines.append(f"- {nm}")
    if len(docs) > 8:
        lines.append(f"- (+{len(docs) - 8} more)")
    return f"{label}:\n" + "\n".join(lines)


def build_client_prompt(
    *,
    client: dict,
    pending_docs: list[dict] | None = None,
    received_docs: list[dict] | None = None,
    days_to_deadline: int | None = None,
    followup_number: int = 0,
    trigger_context: TriggerContext = "client_message",
    inbound_text: str | None = None,
) -> tuple[str, str]:
    """Returns (system_prompt, user_prompt) for the LLM.

    The system message holds the persona + state. The user message holds the
    specific situation (the inbound text, or the follow-up task).
    """
    pending_docs = pending_docs or []
    received_docs = received_docs or []
    name = client.get("name") or client.get("client_name") or "Sir/Madam"

    state = [
        f"Client name: {name}",
        _format_doc_list(pending_docs, "Pending documents"),
    ]
    if received_docs:
        state.append(_format_doc_list(received_docs, "Recently received"))

    system = _BASE_RULES + "\n\nCurrent state:\n" + "\n".join(state)

    if trigger_context == "consent_request":
        user = (
            "Please send a one-line Hinglish greeting introducing yourself as Shalini "
            "(CA's assistant) and ask for consent to send document reminders on Telegram. "
            "Ask the client to reply 'Haan' to agree or 'Nahi' to decline. "
            "Mention only what's needed for compliance work."
        )
    elif trigger_context == "client_message":
        user = (
            f"Client just sent: \"{inbound_text or ''}\".\n"
            "Reply naturally in Hinglish. If they're asking about pending docs, list them. "
            "If they're confirming they'll send something, acknowledge briefly. "
            "If you don't know the answer, say 'CA sir/madam will check kar denge'."
        )
    elif trigger_context == "document_received":
        user = (
            "The client just uploaded a document. Acknowledge with ✅ in one line, "
            "then list what's still pending (use the list above). If nothing is pending, "
            "thank them and say CA sir/madam will review."
        )
    else:  # scheduled_followup
        days_str = (
            "today is the deadline" if days_to_deadline == 0
            else f"{days_to_deadline} days remaining"
            if days_to_deadline is not None and days_to_deadline > 0
            else f"deadline was {abs(days_to_deadline)} days ago"
            if days_to_deadline is not None
            else "deadline soon"
        )
        tone = _urgency_tone(days_to_deadline if days_to_deadline is not None else 5, followup_number)
        user = (
            f"This is reminder #{followup_number + 1}. Status: {days_str}.\n"
            f"{tone}\n"
            "Write a short Hinglish reminder listing the pending docs (max 3 line message)."
        )

    return system, user
