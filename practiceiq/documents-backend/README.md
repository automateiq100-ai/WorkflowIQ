# PracticeIQ Documents — Telegram bot + Gmail ingest + Ask Shalini agent

Python FastAPI service that runs:
- **Shalini** — a Telegram bot clients DM to send compliance documents.
- **Gmail polling worker** — ingests attachments from a connected firm Gmail.
- **CA-facing agent** — `POST /api/shalini/query` powering the "Ask Shalini" UI.
- **Daily 09:00 IST scheduler** — Hinglish follow-ups + CA digest + retention.

The Next.js app at `practiceiq/` is the CA UI; this service is its backend for everything Telegram/Gmail/agent-related.

## Architecture at a glance

```
   ┌─────────────────────┐                      ┌─────────────────────┐
   │ Telegram client(s)  │  /start, text, doc → │ python-telegram-bot │
   └─────────────────────┘                      │   webhook/          │
                                                │   telegram_webhook  │
   ┌─────────────────────┐                      │                     │
   │ Gmail (read-only)   │  poll every 5 min  → │ integrations/gmail  │
   └─────────────────────┘                      └─────────┬───────────┘
                                                          │
                                                          ▼
   ┌─────────────────────┐    POST /api/shalini  ┌─────────────────────┐
   │ Next.js Ask Shalini │ ◄───────────────────► │ FastAPI (this svc)  │
   └─────────────────────┘                       │ agents/shalini_ca   │
                                                 │ — GPT-4o tool loop  │
                                                 └─────────┬───────────┘
                                                           │
                                                Supabase (qqcljfqkrslwqakjjrvw)
                                                  - practiceiq_messages   (chat memory)
                                                  - practiceiq_documents  (doc memory)
                                                  - practiceiq_emails     (email memory)
                                                  - hybrid_search RPCs    (RAG)
                                                  - Storage: practiceiq-docs
```

## Setup

### 1. Python environment

```bash
cd practiceiq/documents-backend
python -m venv .venv
.venv/Scripts/activate   # Windows. Use `source .venv/bin/activate` on macOS/Linux.
pip install -r requirements.txt
```

### 2. Environment variables

The service reads the **repo-root** `.env` (three levels up). Required:

```
# Telegram
TELEGRAM_BOT_TOKEN=...                # @BotFather
TELEGRAM_BOT_USERNAME=YourBotName     # without @ — used by Next.js for invite links
CA_TELEGRAM_CHAT_ID=...               # numeric ID (from @userinfobot) — fallback when not in practiceiq_settings
TELEGRAM_MODE=polling                 # "polling" (dev) | "webhook" (prod)
BACKEND_URL=                          # only when TELEGRAM_MODE=webhook (e.g. https://docs-bot.example.com)

# AI
OPENAI_API_KEY=sk-...                 # GPT-4o, GPT-4o-mini, embeddings
OPENAI_API_KEY_SECONDARY=sk-...       # optional fallback on rate limits
DEEPSEEK_API_KEY=sk-...               # client-facing Hinglish replies (deepseek-chat)

# Supabase
SUPABASE_URL=https://qqcljfqkrslwqakjjrvw.supabase.co
SUPABASE_SERVICE_KEY=eyJ...           # service role; backend bypasses RLS

# Cross-service
DOCUMENTS_BACKEND_URL=http://localhost:8000   # used by Next.js to proxy Ask Shalini

# Gmail (optional — Phase B; if absent, the Gmail poll job is skipped)
GMAIL_CLIENT_ID=...
GMAIL_CLIENT_SECRET=...
GMAIL_REDIRECT_URI=http://localhost:3000/practiceiq/api/practiceiq/integrations/gmail/callback
```

### 3. Gmail OAuth client (Phase B only)

In Google Cloud Console:
1. Create a project, enable **Gmail API**.
2. **OAuth consent screen** → External, add your test users.
3. **Credentials** → Create OAuth client ID (Web application).
4. **Authorized redirect URI** = the value of `GMAIL_REDIRECT_URI`.
5. Copy the client ID / secret into `.env`.

Scopes requested: `gmail.readonly` and `userinfo.email` (read-only — the bot never sends).

### 4. Run the service

```bash
uvicorn main:app --reload --port 8000
```

You should see logs:
- `Telegram bot: polling started`
- `scheduler started (Asia/Kolkata)`
- `Gmail poll job scheduled (5 min interval)` (only if Gmail env vars are set)

## Endpoints

| Method | Path                       | Purpose                                          |
|--------|----------------------------|--------------------------------------------------|
| GET    | `/health`                  | Liveness probe; reports whether bot is running.  |
| POST   | `/api/shalini/query`       | CA agent. Header `X-Owner-User-Id`, body `{messages: [{role, content}, ...]}` or `{prompt, history}`. Returns `{reply, citations}`. |
| POST   | `/telegram/webhook`        | Telegram update receiver (only in webhook mode). |

## How the bot decides what to do

**Telegram inbound:** `webhook/telegram_webhook.py`
1. `require_known_account` looks up `practiceiq_client_telegram_accounts` by chat_id.
   - Unknown chat_ids → silent drop (single log line, no reply).
2. `/start invite_<token>` consumes a row from `practiceiq_telegram_invites` (created from the CA UI).
3. Text → consent flow if not yet given; otherwise Deepseek reply via `agents/shalini_client`.
4. Document/photo → MIME + size check → GPT-4o-mini classifier maps filename+caption to a doc_type from the client's pending checklist → Storage upload → text extraction → embedding → INSERT into `practiceiq_documents` and `practiceiq_messages` → Hinglish reply listing remaining pending docs.

**Gmail polling:** `integrations/gmail.py`
1. For each row in `practiceiq_gmail_credentials`, refresh access token if needed.
2. Pull new messages since `last_history_id` (or initial 30-day lookback).
3. Match `from_email` (case-insensitive) against `practiceiq_client_emails` — unmatched senders are still saved with `client_id=NULL` (CA can triage later).
4. Save body + embedding into `practiceiq_emails`. Save attachments via the existing doc pipeline with `source='email'`.

**Daily 09:00 IST scheduler:** `scheduler/followup_jobs.py`
- `daily_followup_job` — for each consented client × pending doc whose `followup_start_date <= today`, generate a Hinglish reminder via Shalini and send. Broadcast policy honors `practiceiq_clients.followup_broadcast`. One `practiceiq_followup_log` row per `(client, doc_type, period)` regardless of fan-out count.
- `ca_digest_job` — single Telegram digest to `practiceiq_settings.ca_telegram_chat_id` summarizing all pending clients.
- `chat_retention_job` — delete `practiceiq_messages` older than 365 days (02:00 IST).
- `doc_retention_job` — soft-delete `practiceiq_documents` past `retention_until` (02:15 IST).

## CA agent tools (the LLM picks which to call)

`agents/shalini_ca.py` — GPT-4o tool-call loop, max 5 iterations:

| Tool                       | Backed by                              |
|----------------------------|----------------------------------------|
| `get_client_status`        | `db_tools.get_full_status` (fuzzy name) |
| `search_chat_history`      | `hybrid_search` RPC over messages      |
| `search_doc_contents`      | `documents_hybrid_search` RPC          |
| `search_email_history`     | `emails_hybrid_search` RPC (Phase B)   |
| `get_all_pending`          | `db_tools.get_all_pending_clients`     |
| `send_reminder`            | Returns draft only — does NOT send     |
| `mark_received_manually`   | Upserts `practiceiq_document_status`   |

The agent returns `{reply, citations}` — the UI renders citations as a Sources footer.

## Verifying end-to-end

1. **Telegram path**
   - Add a row to `practiceiq_client_telegram_accounts` matching your Telegram chat_id (use the Generate Invite flow from the client detail page in the Next.js app, or insert manually).
   - DM the bot: `/start` → expect Hinglish consent.
   - Reply `Haan` → expect welcome.
   - Send a PDF → expect the file in Storage at `{owner}/{client}/{period}/{doc_type}/...` and a row in `practiceiq_documents`.
   - DM from an unknown chat_id → no reply, single log line.

2. **Gmail path** (after Settings → Connect Gmail in the Next.js app)
   - Email an attachment from a known client email to the connected Gmail.
   - Wait ≤5 min. Check `practiceiq_emails` row + `practiceiq_documents` row with `source='email'`.

3. **Ask Shalini**
   - Open `/practiceiq/documents/ask-shalini`.
   - Ask `What's pending for Sharma Textiles?` — expect a synthesized answer with a Sources footer listing the chats/docs the agent retrieved.

## Safety & privacy

- Logged fields are `client_id`, `doc_type`, `outcome`, `latency_ms`. Never message text, never document bytes, never PII.
- DPDP Act 2023 — Supabase region `ap-south-1` keeps data inside India.
- Shalini never asks for OTPs, passwords, PAN, or Aadhaar in chat.
- Voice/audio replies "V2 mein aayega" — no transcription in V1.
- Refresh tokens for Gmail are stored in `practiceiq_gmail_credentials` (service-role read-only). Production should add Supabase Vault encryption.
