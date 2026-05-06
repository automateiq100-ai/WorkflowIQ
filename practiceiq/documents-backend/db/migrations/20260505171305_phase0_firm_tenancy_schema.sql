-- Mirror of Supabase migration `phase0_firm_tenancy_schema`
-- Applied 2026-05-05 — Mission 0.1.A.
--
-- Why: Phase 0 introduces firm-level tenancy. Previously every tenant table was
-- keyed by `owner_user_id` (single CA). The proposal requires multi-user firms
-- (50 staff, 5 departments). This migration adds:
--   - practiceiq_firms              (the new tenant root)
--   - practiceiq_firm_users         (membership + role)
--   - practiceiq_firm_invites       (admin-issued user invites)
--   - user_firm_ids()               (helper for RLS)
--   - firm_id column                (denormalized on every existing tenant table)
--
-- No data is moved here; backfill is in 20260505171332. RLS swap is in 20260505171714.

create table practiceiq_firms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  gstin text,
  pan text,
  address text,
  state_code text,
  created_at timestamptz not null default now()
);

create table practiceiq_firm_users (
  firm_id uuid not null references practiceiq_firms(id) on delete cascade,
  user_id uuid not null,
  role text not null check (role in ('admin','dept_head','staff','hr_admin')),
  department_id uuid,
  created_at timestamptz not null default now(),
  primary key (firm_id, user_id)
);

create index practiceiq_firm_users_user_id_idx on practiceiq_firm_users(user_id);
create index practiceiq_firm_users_firm_id_idx on practiceiq_firm_users(firm_id);

create table practiceiq_firm_invites (
  token text primary key,
  firm_id uuid not null references practiceiq_firms(id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin','dept_head','staff','hr_admin')),
  department_id uuid,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_by_user_id uuid
);

create index practiceiq_firm_invites_firm_idx on practiceiq_firm_invites(firm_id);
create index practiceiq_firm_invites_email_idx on practiceiq_firm_invites(email) where consumed_at is null;

create or replace function user_firm_ids() returns setof uuid
language sql security invoker stable
as $$
  select firm_id from practiceiq_firm_users where user_id = auth.uid();
$$;

-- firm_id columns on every existing tenant table.
alter table practiceiq_clients                       add column firm_id uuid;
alter table practiceiq_tasks                         add column firm_id uuid;
alter table practiceiq_invoices                      add column firm_id uuid;
alter table practiceiq_documents                     add column firm_id uuid;
alter table practiceiq_service_templates             add column firm_id uuid;
alter table practiceiq_service_template_doc_types    add column firm_id uuid;
alter table practiceiq_client_services               add column firm_id uuid;
alter table practiceiq_client_service_doc_types      add column firm_id uuid;
alter table practiceiq_client_emails                 add column firm_id uuid;
alter table practiceiq_client_telegram_accounts      add column firm_id uuid;
alter table practiceiq_telegram_invites              add column firm_id uuid;
alter table practiceiq_messages                      add column firm_id uuid;
alter table practiceiq_emails                        add column firm_id uuid;
alter table practiceiq_document_checklist            add column firm_id uuid;
alter table practiceiq_document_status               add column firm_id uuid;
alter table practiceiq_followup_log                  add column firm_id uuid;
alter table practiceiq_settings                      add column firm_id uuid;
alter table practiceiq_gmail_credentials             add column firm_id uuid;
alter table practiceiq_ca_telegram_setup             add column firm_id uuid;

create index practiceiq_clients_firm_idx                       on practiceiq_clients(firm_id);
create index practiceiq_tasks_firm_idx                         on practiceiq_tasks(firm_id);
create index practiceiq_invoices_firm_idx                      on practiceiq_invoices(firm_id);
create index practiceiq_documents_firm_idx                     on practiceiq_documents(firm_id);
create index practiceiq_service_templates_firm_idx             on practiceiq_service_templates(firm_id);
create index practiceiq_service_template_doc_types_firm_idx    on practiceiq_service_template_doc_types(firm_id);
create index practiceiq_client_services_firm_idx               on practiceiq_client_services(firm_id);
create index practiceiq_client_service_doc_types_firm_idx      on practiceiq_client_service_doc_types(firm_id);
create index practiceiq_client_emails_firm_idx                 on practiceiq_client_emails(firm_id);
create index practiceiq_client_telegram_accounts_firm_idx      on practiceiq_client_telegram_accounts(firm_id);
create index practiceiq_telegram_invites_firm_idx              on practiceiq_telegram_invites(firm_id);
create index practiceiq_messages_firm_idx                      on practiceiq_messages(firm_id);
create index practiceiq_emails_firm_idx                        on practiceiq_emails(firm_id);
create index practiceiq_document_checklist_firm_idx            on practiceiq_document_checklist(firm_id);
create index practiceiq_document_status_firm_idx               on practiceiq_document_status(firm_id);
create index practiceiq_followup_log_firm_idx                  on practiceiq_followup_log(firm_id);
