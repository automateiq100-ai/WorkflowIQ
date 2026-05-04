# Step 6 — Embeddings + hybrid (vector + metadata) search.


async def embed_text(text: str) -> list[float]:
    raise NotImplementedError("Step 6")


async def hybrid_search(
    client_id: str,
    query: str,
    doc_type: str | None = None,
    period: str | None = None,
    top_k: int = 5,
) -> list[dict]:
    raise NotImplementedError("Step 6")
