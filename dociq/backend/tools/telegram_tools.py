# Step 5 — Async Telegram Bot wrappers + Supabase Storage upload.


async def send_text(chat_id: int, text: str) -> int:
    raise NotImplementedError("Step 5")


async def send_document(
    chat_id: int, file_bytes: bytes, filename: str, caption: str | None = None
) -> int:
    raise NotImplementedError("Step 5")


async def download_file(file_id: str) -> bytes:
    raise NotImplementedError("Step 5")


async def send_ca_notification(ca_chat_id: int, text: str) -> int:
    raise NotImplementedError("Step 5")


async def upload_to_supabase_storage(
    client_id: str, filename: str, file_bytes: bytes
) -> str:
    raise NotImplementedError("Step 5")
