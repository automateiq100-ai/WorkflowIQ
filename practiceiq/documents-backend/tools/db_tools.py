# Step 4 — Async Supabase wrappers. Only RPC: hybrid_search (in search_tools).


async def get_client_by_telegram_id(chat_id: int) -> dict | None:
    raise NotImplementedError("Step 4")


async def get_client_by_id(client_id: str) -> dict:
    raise NotImplementedError("Step 4")


async def list_clients(ca_firm_id: str) -> list[dict]:
    raise NotImplementedError("Step 4")


async def save_message(message: dict) -> str:
    raise NotImplementedError("Step 4")


async def update_message_embedding(message_id: str, embedding: list[float]) -> None:
    raise NotImplementedError("Step 4")


async def get_pending_docs(client_id: str) -> list[dict]:
    raise NotImplementedError("Step 4")


async def get_received_docs(client_id: str) -> list[dict]:
    raise NotImplementedError("Step 4")


async def mark_doc_received(client_id: str, doc_type: str, message_id: str) -> None:
    raise NotImplementedError("Step 4")


async def get_followup_count(client_id: str, doc_type: str) -> int:
    raise NotImplementedError("Step 4")


async def log_followup(
    client_id: str, doc_type: str, urgency: str, text: str, tg_message_id: int
) -> None:
    raise NotImplementedError("Step 4")


async def set_consent(client_id: str, given: bool) -> None:
    raise NotImplementedError("Step 4")


async def get_full_status(client_id: str) -> dict:
    raise NotImplementedError("Step 4")


async def get_all_pending_clients(ca_firm_id: str) -> list[dict]:
    raise NotImplementedError("Step 4")
