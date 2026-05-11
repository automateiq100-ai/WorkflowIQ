-- Mirror of Supabase migration `practiceiq_emails_and_gmail_credentials`
-- Applied via Supabase MCP on project qqcljfqkrslwqakjjrvw on 2026-05-05.
-- Source of truth is the Supabase project; this file exists for audit + DR replay.
--
-- Why: enables Gmail ingestion (Phase B). Adds:
--   - practiceiq_emails: ingested email metadata + body, embedding, FTS — separate from
--     practiceiq_client_emails which only holds addresses.
--   - practiceiq_gmail_credentials: per-CA OAuth refresh tokens. Service-role-only writes.
--   - emails_hybrid_search RPC: RRF over body_plain + subject + snippet, mirroring
--     documents_hybrid_search shape.
--   - practiceiq_documents.source_email_id: FK so an email's attachments can be traced
--     back to the email row.

create table practiceiq_emails (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  client_id uuid references practiceiq_clients(id) on delete set null,
  client_email_id uuid references practiceiq_client_emails(id) on delete set null,
  gmail_message_id text not null,
  gmail_thread_id text,
  from_email text,
  from_name text,
  to_emails text[],
  cc_emails text[],
  subject text,
  body_plain text,
  snippet text,
  received_at timestamptz,
  has_attachments boolean not null default false,
  embedding vector(1536),
  fts tsvector generated always as (
    to_tsvector('english', coalesce(subject, '') || ' ' || coalesce(snippet, '') || ' ' || coalesce(body_plain, ''))
  ) stored,
  created_at timestamptz not null default now(),
  unique (owner_user_id, gmail_message_id)
);

create index practiceiq_emails_owner_idx on practiceiq_emails(owner_user_id);
create index practiceiq_emails_client_idx on practiceiq_emails(client_id);
create index practiceiq_emails_received_idx on practiceiq_emails(received_at desc);
create index practiceiq_emails_embedding_hnsw on practiceiq_emails using hnsw (embedding vector_cosine_ops);
create index practiceiq_emails_fts_idx on practiceiq_emails using gin(fts);

alter table practiceiq_emails enable row level security;
create policy "owner can select emails" on practiceiq_emails
  for select using (auth.uid() = owner_user_id);
create policy "owner can update emails" on practiceiq_emails
  for update using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);
-- Insert/delete done via service role only (no policy → blocked for auth users).

create table practiceiq_gmail_credentials (
  owner_user_id uuid primary key,
  email text not null,
  refresh_token text not null,
  access_token text,
  access_token_expires_at timestamptz,
  last_history_id text,
  scopes text[],
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table practiceiq_gmail_credentials enable row level security;
-- Owner can see whether they're connected (email + connected_at) — RLS lets them read,
-- but never the refresh_token in practice because the API route returns only safe columns.
create policy "owner can read gmail connection state" on practiceiq_gmail_credentials
  for select using (auth.uid() = owner_user_id);
-- No insert/update/delete policies → only service role writes.

alter table practiceiq_documents
  add column if not exists source_email_id uuid references practiceiq_emails(id) on delete set null;

create index if not exists practiceiq_documents_source_email_idx
  on practiceiq_documents(source_email_id) where source_email_id is not null;

create or replace function emails_hybrid_search(
  p_owner_user_id uuid,
  p_query_text text,
  p_query_embedding vector(1536),
  p_client_id uuid default null,
  p_match_count int default 5
) returns table (
  id uuid,
  client_id uuid,
  from_email text,
  subject text,
  snippet text,
  received_at timestamptz,
  rrf_score numeric
)
language sql
stable
as $$
  with vec as (
    select e.id, e.client_id, e.from_email, e.subject, e.snippet, e.received_at,
           row_number() over (order by e.embedding <=> p_query_embedding asc) as rn
    from practiceiq_emails e
    where e.owner_user_id = p_owner_user_id
      and (p_client_id is null or e.client_id = p_client_id)
      and e.embedding is not null
    order by e.embedding <=> p_query_embedding asc
    limit greatest(p_match_count * 4, 20)
  ),
  fts as (
    select e.id, e.client_id, e.from_email, e.subject, e.snippet, e.received_at,
           row_number() over (order by ts_rank(e.fts, plainto_tsquery('english', p_query_text)) desc) as rn
    from practiceiq_emails e
    where e.owner_user_id = p_owner_user_id
      and (p_client_id is null or e.client_id = p_client_id)
      and e.fts @@ plainto_tsquery('english', p_query_text)
    order by ts_rank(e.fts, plainto_tsquery('english', p_query_text)) desc
    limit greatest(p_match_count * 4, 20)
  ),
  combined as (
    select id, client_id, from_email, subject, snippet, received_at,
           sum(1.0 / (60 + rn)) as rrf_score
    from (
      select * from vec
      union all
      select * from fts
    ) all_rows
    group by id, client_id, from_email, subject, snippet, received_at
  )
  select id, client_id, from_email, subject, snippet, received_at, rrf_score
  from combined
  order by rrf_score desc
  limit p_match_count;
$$;
