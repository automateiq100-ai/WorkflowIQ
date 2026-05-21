-- AccountingIQ — standalone auth profile table
-- ----------------------------------------------------------------------------
-- AccountingIQ has its own auth (email/password) and its own profile table,
-- independent of the WorkflowIQ portal's `workflowiq_clients`. It reuses the
-- same Supabase project, so the underlying `auth.users` table is shared, but no
-- portal tables are read or written by this app.
--
-- Apply once against your Supabase project (SQL editor or `supabase db push`).

create table if not exists public.accountingiq_users (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text,
  mobile      text,
  theme       text default 'dark',
  created_at  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);

alter table public.accountingiq_users enable row level security;

-- Authenticated users may read and update only their own profile row.
-- (The server uses the service-role key, which bypasses RLS, for the
-- bootstrap upsert in app/page.tsx and app/auth/callback.)
drop policy if exists "accountingiq_users self select" on public.accountingiq_users;
create policy "accountingiq_users self select"
  on public.accountingiq_users for select
  using (auth.uid() = id);

drop policy if exists "accountingiq_users self update" on public.accountingiq_users;
create policy "accountingiq_users self update"
  on public.accountingiq_users for update
  using (auth.uid() = id);
