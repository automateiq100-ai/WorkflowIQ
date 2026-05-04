# DocIQ — Telegram bot service for the PracticeIQ Documents module

## Purpose
This directory contains **only the Python FastAPI service** that runs the Telegram bot ("Shalini") and the daily follow-up scheduler. It is one half of the Documents feature; the user-facing UI lives inside PracticeIQ at `practiceiq/app/(app)/documents/`.

Why split? Next.js can't host long-running pollers (Telegram getUpdates) or schedulers (APScheduler) inside its request lifecycle. The bot needs to be a separate process. PracticeIQ's "Ask Shalini" UI proxies to this service via HTTP.

| Concern | Lives in |
|---|---|
| Telegram polling/webhook, document classification, OCR-light text extraction, Hinglish replies, daily follow-up cron | `dociq/backend/` (this dir) |
| CA-facing Inbox, Follow-up Queue, Ask Shalini chat UI, manual upload | `practiceiq/app/(app)/documents/` |
| All persistent data | shared Supabase project `qqcljfqkrslwqakjjrvw` |

---

## Tech Stack
- **Language**: Python 3.11, async/await throughout, type hints on public functions
- **Framework**: FastAPI + `uvicorn[standard]`
- **Telegram**: `python-telegram-bot==21.9` (single shared `Bot` + `Application`, polling for dev / webhook for prod)
- **DB/Storage**: Supabase project `qqcljfqkrslwqakjjrvw` (Postgres 17 + pgvector + Storage), region `ap-south-1`
- **AI**:
  - Client-facing replies — Deepseek `deepseek-chat` (OpenAI SDK with `base_url=https://api.deepseek.com/v1`)
  - CA-facing queries — OpenAI GPT-4o (tool-calling)
  - Document classification — OpenAI GPT-4o-mini
  - Embeddings — OpenAI `text-embedding-3-small` (1536-dim)
- **Text extraction (no OCR)**: `pdfplumber` (digital PDFs), `openpyxl` (xlsx), `xlrd` (xls), stdlib for txt/csv/xml
- **Scheduler**: `apscheduler` `AsyncIOScheduler`, timezone `Asia/Kolkata`
- **Logging**: `loguru` at INFO. Logged fields: `client_id`, `doc_type`, `outcome`, `latency_ms` only — never message text, never document bytes, never PII

---

## Directory
```
dociq/
├── CLAUDE.md                       ← this file
└── backend/
    ├── main.py                     FastAPI + bot startup + scheduler boot
    ├── requirements.txt
    ├── .env.example
    ├── db/
    │   └── schema.sql              Canonical mirror of deployed Supabase state (do NOT re-run on the live project)
    ├── agents/
    │   ├── shalini_client.py       generate_client_message() — Deepseek
    │   └── shalini_ca.py           query_shalini() — GPT-4o tool-call loop
    ├── prompts/
    │   ├── client_prompt.py        Hinglish urgency-ladder system prompt
    │   └── ca_prompt.py            Tool-aware CA system prompt
    ├── tools/
    │   ├── db_tools.py             Async Supabase wrappers
    │   ├── telegram_tools.py       Bot wrappers + Storage upload
    │   ├── extract_tools.py        text/csv/xml/xlsx/PDF-text extraction (no image OCR)
    │   └── search_tools.py         embed_text + hybrid_search (chats) + documents_hybrid_search (doc contents)
    ├── webhook/
    │   └── telegram_webhook.py     CommandHandler/MessageHandler routing
    └── scheduler/
        └── followup_jobs.py        daily_followup_job, ca_digest_job, chat_retention_job, doc_retention_job (all 09:00 IST)
```

---

## Environment Variables

DocIQ loads the **repo-root** `.env` (two levels up from `backend/main.py`).

```
# Telegram
TELEGRAM_BOT_TOKEN=...               # @BotFather
CA_TELEGRAM_CHAT_ID=...              # CA's numeric Telegram user ID (also stored in practiceiq_settings.ca_telegram_chat_id)
TELEGRAM_MODE=polling                # "polling" (dev) | "webhook" (prod)
BACKEND_URL=                         # Required only if TELEGRAM_MODE=webhook

# AI
OPENAI_API_KEY=sk-...                # Primary (GPT-4o, GPT-4o-mini, embeddings)
OPENAI_API_KEY_SECONDARY=sk-...      # Fallback on RateLimitError
DEEPSEEK_API_KEY=sk-...              # Client-facing replies (deepseek-chat)

# Supabase (already in repo .env)
SUPABASE_URL=https://...
SUPABASE_SERVICE_KEY=eyJ...          # Service role key (server-side only)

# Cross-service
DOCIQ_BACKEND_URL=http://localhost:8000   # Used by Next.js to proxy "Ask Shalini" + "Send reminder" to this service
```

---

## Tenancy model

Single-tenant per CA in V1:
- Each CA = one Supabase auth user = one `owner_user_id`.
- `practiceiq_clients.owner_user_id` scopes all Shalini data.
- The bot looks up the CA's `owner_user_id` once at startup by matching `practiceiq_settings.ca_telegram_chat_id` to the value in `.env` / known mapping. Then every DB write uses that scope.

---

## Document collection flow
```
client DMs bot
  → /start → DPDPA consent in Hinglish (single Q: "Haan/Nahi"); writes practiceiq_clients.consent_given
  → text     → save to dociq_messages + embed → generate_client_message (Deepseek) → reply + save outbound + embed
  → document → validate (≤50MB, MIME in allowlist)
              → classify doc_type via GPT-4o-mini (filename + caption + checklist)
              → upload to Supabase Storage bucket `practiceiq-docs`,
                path `{owner_user_id}/{client_id}/{filing_period}/{doc_type}/{ts}_{filename}`
              → extract_text() for text/csv/xml/xlsx/digital-PDF; image/scanned-PDF → ocr_text=NULL
              → embed (caption + filename + ocr_text[:2000])
              → INSERT practiceiq_documents (source='telegram', source_ref=<msg_id>, uploaded_by='shalini',
                                              status='received', retention_until = today + 1 year)
              → INSERT dociq_messages (message_type='document', document_id=<new>, embedding)
              → UPDATE dociq_document_status → received
              → reply with remaining pending docs (Hinglish)
              → if checklist complete → send Telegram message to practiceiq_settings.ca_telegram_chat_id
  → voice/audio → "V2 mein aayega" (V1 does not transcribe)
```

## Daily 09:00 IST scheduler
- `daily_followup_job` — for each consented client × each pending doc where `today >= followup_start_date` and no follow-up sent today: increment counter, generate Hinglish message via Shalini, send, log to `dociq_followup_log`.
- `ca_digest_job` — single Telegram message to CA summarizing overdue + T-1 clients.
- `chat_retention_job` — delete `dociq_messages` older than 365 days.
- `doc_retention_job` — soft-delete `practiceiq_documents` past `retention_until` (`deleted_at = now()`).

## CA query flow (`POST /api/shalini/query`)
GPT-4o tool-call loop, cap 5 iterations. Tools:
- `get_client_status(client_name_or_id)`
- `search_chat_history(client_id, query)` — `hybrid_search` RPC over `dociq_messages`
- `search_doc_contents(query, client_id?)` — `documents_hybrid_search` RPC over `practiceiq_documents.ocr_text`
- `get_all_pending(ca_firm_id)` — joins `dociq_document_status` + `dociq_document_checklist`
- `send_reminder(client_id, doc_type)` — **returns draft only**, does not send
- `mark_received_manually(client_id, doc_type)`

## Hinglish urgency ladder (in `prompts/client_prompt.py`)
| follow-up # | days to deadline | tone |
|---|---|---|
| 1 | T-6 to T-4 | friendly nudge |
| 2 | T-3 | warmer reminder |
| 3 | T-1 | urgent, "kal deadline hai" |
| 4+ | T+ | escalation, mentions late fees |

## DPDPA notes
- DPDP Act 2023: data residency is satisfied by Supabase `ap-south-1`.
- Consent gates **all** outbound bot messages. `consent_given` defaults to `false` until the client replies `Haan` to the `/start` prompt.
- Shalini never asks for OTPs, passwords, PAN, or Aadhaar in chat.
- All file uploads validated against MIME allowlist (PDF, JPG, PNG, HEIC, XLSX, XLS, CSV, XML); max 50 MB.
- Soft delete only. 1-year chat retention; document retention configurable per row via `retention_until`.

---

## Deployed schema (post-migration)

| Table | Notes |
|---|---|
| `practiceiq_clients` | extended with `telegram_chat_id` (text+UNIQUE), `telegram_username`, `telegram_first_name`, `consent_given`, `consent_at`, `filing_period`, `entity_type` |
| `practiceiq_settings` | extended with `ca_telegram_chat_id` (text) |
| `practiceiq_documents` | extended with `source`, `source_ref`, `uploaded_by`, `mime_type`, `doc_type`, `filing_period`, `ocr_text`, `embedding vector(1536)`, `status`, `verified_by`, `verified_at`, `rejection_reason`, `deleted_at`, `retention_until`, `is_sensitive`. HNSW + FTS indexes. |
| `dociq_messages` | bot conversation log; `document_id` FK → `practiceiq_documents` |
| `dociq_document_checklist` | what to collect per client per period |
| `dociq_document_status` | pending/received/overdue per client × doc_type |
| `dociq_followup_log` | every reminder Shalini sent |

### RPCs
- `hybrid_search(p_client_id, p_query_text, p_query_embedding, p_doc_type?, p_period?, p_match_count=5)` — RRF over `dociq_messages` (vector + FTS)
- `documents_hybrid_search(p_owner_user_id, p_query_text, p_query_embedding, p_client_id?, p_doc_type?, p_period?, p_match_count=5)` — same shape over `practiceiq_documents.ocr_text`

### Storage
Bucket `practiceiq-docs` (already exists). Path: `{owner_user_id}/{client_id}/{filing_period}/{doc_type}/{ts}_{filename}`. Signed URLs (5-min) generated by Next.js on demand.

### RLS posture (V1)
RLS enabled, no policies on the new tables. Backend uses **service role key** which bypasses RLS, so this is safe for V1. Add per-`owner_user_id` policies before exposing any table directly via PostgREST.

---

## Build status
Step A (schema unification) complete. See `~/.claude/plans/build-shalini-wild-seal.md` for the remaining steps (B sidebar/routes, C API routes, D Python service alignment, E agents/scheduler, F drop legacy tables).
