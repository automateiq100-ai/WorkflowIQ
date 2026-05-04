-- DocIQ V1 — canonical schema.
--
-- This file mirrors what is actually deployed in Supabase project
-- qqcljfqkrslwqakjjrvw (ap-south-1). It is idempotent and safe to re-run.
-- The schema was applied via Supabase MCP migrations:
--   - shalini_v1_schema             (initial — pre-existing tables, indexes, RPC)
--   - dociq_v1_finalize             (added ca_firms, ca_notifications, columns, seeds)
--   - dociq_harden_hybrid_search_search_path
--
-- DO NOT use this file as a fresh-install script if the migrations above
-- have already run on the target project. Use it only to seed a brand-new
-- Supabase project.

-- ─── Extensions ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto    SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS vector;  -- in public (Supabase default)

-- ─── ca_firms ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ca_firms (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 text NOT NULL,
  gstin                text,
  ca_telegram_chat_id  text,
  created_at           timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ca_firms ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.ca_firms IS
  'CA firm tenant. ca_telegram_chat_id is the chat where Shalini sends digests/all-docs-received notifications.';

-- ─── clients ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.clients (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  first_name          text,
  gstin               text CHECK (gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  phone_number        text UNIQUE,
  telegram_chat_id    text UNIQUE,
  telegram_username   text,
  ca_firm_id          uuid REFERENCES public.ca_firms(id) ON DELETE SET NULL,
  filing_period       text,
  entity_type         text CHECK (entity_type IN ('proprietorship','pvt_ltd','llp','huf')),
  consent_given       boolean NOT NULL DEFAULT false,
  ca_notified_at      timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

-- ─── document_checklist ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.document_checklist (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id            uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  doc_type             text NOT NULL CHECK (doc_type IN
    ('gstr1_invoices','tds_challan','sales_register','purchase_register','bank_statement')),
  label                text NOT NULL,
  deadline_date        date NOT NULL,
  followup_start_date  date NOT NULL
);
ALTER TABLE public.document_checklist ENABLE ROW LEVEL SECURITY;

-- ─── messages ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.messages (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  external_message_id   text UNIQUE,                               -- Telegram message id
  sender                text NOT NULL CHECK (sender IN ('client','shalini')),
  message_type          text NOT NULL CHECK (message_type IN ('text','document','audio','image')),
  raw_text              text,
  ocr_text              text,                                      -- V2: extracted doc text
  doc_type              text,                                      -- nullable on plain chats
  period                text,                                      -- e.g. '2025-04'
  file_url              text,
  timestamp             timestamptz NOT NULL DEFAULT now(),
  embedding             vector(1536)                               -- OpenAI text-embedding-3-small
);
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS messages_client_time_idx
  ON public.messages (client_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS messages_embedding_hnsw
  ON public.messages USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS messages_fts_idx
  ON public.messages USING gin (
    to_tsvector('english', coalesce(raw_text,'') || ' ' || coalesce(ocr_text,''))
  );

-- ─── document_status ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.document_status (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  doc_type              text NOT NULL,
  status                text NOT NULL CHECK (status IN ('pending','received','overdue')),
  received_at           timestamptz,
  received_message_id   uuid REFERENCES public.messages(id) ON DELETE SET NULL
);
ALTER TABLE public.document_status ENABLE ROW LEVEL SECURITY;

-- ─── followup_log ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.followup_log (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  doc_type              text NOT NULL,
  sent_at               timestamptz NOT NULL DEFAULT now(),
  urgency_level         text NOT NULL CHECK (urgency_level IN
    ('calm','moderate','urgent','critical','overdue')),
  message_text          text NOT NULL,
  external_message_id   text                                       -- Telegram message id of the follow-up
);
ALTER TABLE public.followup_log ENABLE ROW LEVEL SECURITY;

-- ─── ca_notifications ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ca_notifications (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ca_firm_id            uuid NOT NULL REFERENCES public.ca_firms(id) ON DELETE CASCADE,
  client_id             uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  type                  text NOT NULL CHECK (type IN
    ('all_docs_received','daily_digest','urgent_overdue','manual')),
  body                  text,
  external_message_id   text,
  sent_at               timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ca_notifications ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS ca_notifications_ca_firm_time_idx
  ON public.ca_notifications (ca_firm_id, sent_at DESC);

-- ─── hybrid_search RPC ───────────────────────────────────────────────────────
-- Reciprocal Rank Fusion: combines pgvector cosine similarity (semantic)
-- and tsvector keyword match (FTS) into a single ranked result per client.
CREATE OR REPLACE FUNCTION public.hybrid_search(
  p_client_id        uuid,
  p_query_text       text,
  p_query_embedding  vector,
  p_doc_type         text DEFAULT NULL,
  p_period           text DEFAULT NULL,
  p_match_count      integer DEFAULT 5
) RETURNS TABLE (
  id          uuid,
  raw_text    text,
  ocr_text    text,
  file_url    text,
  doc_type    text,
  period      text,
  ts          timestamptz,
  similarity  double precision,
  rrf_score   double precision
)
LANGUAGE sql STABLE
SET search_path = public, pg_catalog
AS $$
  with
  filtered as (
    select m.*
    from messages m
    where m.client_id = p_client_id
      and (p_doc_type is null or m.doc_type = p_doc_type)
      and (p_period   is null or m.period   = p_period)
  ),
  semantic as (
    select
      f.id,
      row_number() over (order by f.embedding <=> p_query_embedding) as rnk,
      1 - (f.embedding <=> p_query_embedding) as similarity
    from filtered f
    where f.embedding is not null
    order by f.embedding <=> p_query_embedding
    limit greatest(p_match_count * 4, 20)
  ),
  keyword as (
    select
      f.id,
      row_number() over (order by ts_rank(
        to_tsvector('english', coalesce(f.raw_text,'') || ' ' || coalesce(f.ocr_text,'')),
        plainto_tsquery('english', p_query_text)
      ) desc) as rnk
    from filtered f
    where to_tsvector('english', coalesce(f.raw_text,'') || ' ' || coalesce(f.ocr_text,''))
          @@ plainto_tsquery('english', p_query_text)
    limit greatest(p_match_count * 4, 20)
  ),
  fused as (
    select
      coalesce(s.id, k.id) as id,
      coalesce(1.0/(60 + s.rnk), 0) + coalesce(1.0/(60 + k.rnk), 0) as rrf_score,
      coalesce(s.similarity, 0) as similarity
    from semantic s
    full outer join keyword k on s.id = k.id
  )
  select
    f.id, m.raw_text, m.ocr_text, m.file_url, m.doc_type, m.period,
    m.timestamp as ts, f.similarity, f.rrf_score
  from fused f
  join messages m on m.id = f.id
  order by f.rrf_score desc
  limit p_match_count;
$$;

-- ─── Seed: 1 CA firm + 5 clients + 25 checklist + 25 pending status ──────────
DO $seed$
DECLARE
  v_ca_firm_id uuid;
BEGIN
  SELECT id INTO v_ca_firm_id FROM public.ca_firms WHERE name = 'Khanna & Associates' LIMIT 1;
  IF v_ca_firm_id IS NULL THEN
    INSERT INTO public.ca_firms (name, gstin, ca_telegram_chat_id)
    VALUES ('Khanna & Associates', '07AAACK1234L1Z0', '1825600707')
    RETURNING id INTO v_ca_firm_id;
  END IF;

  INSERT INTO public.clients (ca_firm_id, name, first_name, gstin, telegram_chat_id, telegram_username, filing_period, entity_type)
  SELECT v_ca_firm_id, 'Patel Trading LLP',        'Patel',  '24AABCP1234E1Z3', NULL, NULL, '2025-04', 'llp'
  WHERE NOT EXISTS (SELECT 1 FROM public.clients WHERE name = 'Patel Trading LLP');

  INSERT INTO public.clients (ca_firm_id, name, first_name, gstin, telegram_chat_id, telegram_username, filing_period, entity_type)
  SELECT v_ca_firm_id, 'Priya Sharma Pvt Ltd',     'Priya',  '07AAFCS1234D1Z9', NULL, NULL, '2025-04', 'pvt_ltd'
  WHERE NOT EXISTS (SELECT 1 FROM public.clients WHERE name = 'Priya Sharma Pvt Ltd');

  INSERT INTO public.clients (ca_firm_id, name, first_name, gstin, telegram_chat_id, telegram_username, filing_period, entity_type)
  SELECT v_ca_firm_id, 'Rajesh Kumar Traders',     'Rajesh', '09AAAPK1234F1Z8', NULL, NULL, '2025-04', 'proprietorship'
  WHERE NOT EXISTS (SELECT 1 FROM public.clients WHERE name = 'Rajesh Kumar Traders');

  INSERT INTO public.clients (ca_firm_id, name, first_name, gstin, telegram_chat_id, telegram_username, filing_period, entity_type)
  SELECT v_ca_firm_id, 'Anjali Mehta Enterprises', 'Anjali', '27AAFCA1234B1Z5', '-9000000001', 'anjalimehta_test', '2025-04', 'proprietorship'
  WHERE NOT EXISTS (SELECT 1 FROM public.clients WHERE name = 'Anjali Mehta Enterprises');

  INSERT INTO public.clients (ca_firm_id, name, first_name, gstin, telegram_chat_id, telegram_username, filing_period, entity_type)
  SELECT v_ca_firm_id, 'Singh Brothers HUF',       'Singh',  '07AAEHS1234C1Z2', '-9000000002', 'singhbros_test',   '2025-04', 'huf'
  WHERE NOT EXISTS (SELECT 1 FROM public.clients WHERE name = 'Singh Brothers HUF');

  -- 5 docs per client × 5 clients = 25 checklist rows
  INSERT INTO public.document_checklist (client_id, doc_type, label, deadline_date, followup_start_date)
  SELECT c.id, t.doc_type, t.label, t.deadline_date, t.deadline_date - 6
  FROM public.clients c
  CROSS JOIN (VALUES
    ('tds_challan',       'TDS Challan (April 2025)',       DATE '2025-05-07'),
    ('sales_register',    'Sales Register (April 2025)',    DATE '2025-05-08'),
    ('purchase_register', 'Purchase Register (April 2025)', DATE '2025-05-08'),
    ('bank_statement',    'Bank Statement (April 2025)',    DATE '2025-05-10'),
    ('gstr1_invoices',    'GSTR-1 Invoices (April 2025)',   DATE '2025-05-11')
  ) AS t(doc_type, label, deadline_date)
  WHERE c.ca_firm_id = v_ca_firm_id
    AND NOT EXISTS (
      SELECT 1 FROM public.document_checklist dc
      WHERE dc.client_id = c.id AND dc.doc_type = t.doc_type
    );

  -- Pending status rows for each checklist entry
  INSERT INTO public.document_status (client_id, doc_type, status)
  SELECT dc.client_id, dc.doc_type, 'pending'
  FROM public.document_checklist dc
  WHERE NOT EXISTS (
    SELECT 1 FROM public.document_status ds
    WHERE ds.client_id = dc.client_id AND ds.doc_type = dc.doc_type
  );
END $seed$;
