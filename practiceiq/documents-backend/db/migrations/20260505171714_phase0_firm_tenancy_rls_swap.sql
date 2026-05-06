-- Mirror of Supabase migration `phase0_firm_tenancy_rls_swap_v2`
-- Applied 2026-05-05 — Mission 0.1.C.
--
-- Why: After backfill is complete, finalize the tenancy swap.
--   1. Set NOT NULL on firm_id everywhere.
--   2. Drop all owner_user_id-based RLS policies.
--   3. PK swap on firm-level config tables (settings, gmail_credentials,
--      ca_telegram_setup) — drop owner_user_id, add firm_id PK.
--   4. Add firm_id FKs to practiceiq_firms.
--   5. Add new firm-keyed RLS policies (every authenticated user in a firm can
--      read/write rows of that firm). Role-based restriction comes in later
--      missions.
--   6. Enable RLS on the three new tables (firms, firm_users, firm_invites)
--      and add admin-gated policies for firm_users and firm_invites mutations.
--
-- After this point, owner_user_id is purely a "this row was created/assigned to
-- this human" signal, not a tenancy key. It will be renamed to
-- `assigned_to_user_id` at the end of Phase 1.

-- ===== 1. NOT NULL on firm_id everywhere. =====
do $$ declare r record;
begin
  for r in
    select unnest(array[
      'practiceiq_clients','practiceiq_tasks','practiceiq_invoices','practiceiq_documents',
      'practiceiq_service_templates','practiceiq_service_template_doc_types',
      'practiceiq_client_services','practiceiq_client_service_doc_types',
      'practiceiq_client_emails','practiceiq_client_telegram_accounts',
      'practiceiq_telegram_invites','practiceiq_messages','practiceiq_emails',
      'practiceiq_document_checklist','practiceiq_document_status','practiceiq_followup_log',
      'practiceiq_settings','practiceiq_gmail_credentials','practiceiq_ca_telegram_setup'
    ]) as table_name
  loop
    execute format('alter table %I alter column firm_id set not null', r.table_name);
  end loop;
end$$;

-- ===== 2. Drop ALL existing owner-keyed RLS policies. =====
drop policy if exists "owner can delete own ca setup tokens"      on practiceiq_ca_telegram_setup;
drop policy if exists "owner can insert own ca setup tokens"      on practiceiq_ca_telegram_setup;
drop policy if exists "owner can select own ca setup tokens"      on practiceiq_ca_telegram_setup;
drop policy if exists "owner can delete client emails"            on practiceiq_client_emails;
drop policy if exists "owner can insert client emails"            on practiceiq_client_emails;
drop policy if exists "owner can select client emails"            on practiceiq_client_emails;
drop policy if exists "owner can update client emails"            on practiceiq_client_emails;
drop policy if exists "owner can delete client service doc types" on practiceiq_client_service_doc_types;
drop policy if exists "owner can insert client service doc types" on practiceiq_client_service_doc_types;
drop policy if exists "owner can select client service doc types" on practiceiq_client_service_doc_types;
drop policy if exists "owner can update client service doc types" on practiceiq_client_service_doc_types;
drop policy if exists "owner can delete client services"          on practiceiq_client_services;
drop policy if exists "owner can insert client services"          on practiceiq_client_services;
drop policy if exists "owner can select client services"          on practiceiq_client_services;
drop policy if exists "owner can update client services"          on practiceiq_client_services;
drop policy if exists "owner can delete telegram accounts"        on practiceiq_client_telegram_accounts;
drop policy if exists "owner can insert telegram accounts"        on practiceiq_client_telegram_accounts;
drop policy if exists "owner can select telegram accounts"        on practiceiq_client_telegram_accounts;
drop policy if exists "owner can update telegram accounts"        on practiceiq_client_telegram_accounts;
drop policy if exists "pq_clients_owner"                          on practiceiq_clients;
drop policy if exists "pq_doc_checklist_owner"                    on practiceiq_document_checklist;
drop policy if exists "pq_doc_status_owner"                       on practiceiq_document_status;
drop policy if exists "pq_documents_owner"                        on practiceiq_documents;
drop policy if exists "owner can select emails"                   on practiceiq_emails;
drop policy if exists "owner can update emails"                   on practiceiq_emails;
drop policy if exists "pq_followup_owner"                         on practiceiq_followup_log;
drop policy if exists "owner can read gmail connection state"     on practiceiq_gmail_credentials;
drop policy if exists "pq_invoices_owner"                         on practiceiq_invoices;
drop policy if exists "pq_messages_owner"                         on practiceiq_messages;
drop policy if exists "owner can delete template doc types"       on practiceiq_service_template_doc_types;
drop policy if exists "owner can insert template doc types"       on practiceiq_service_template_doc_types;
drop policy if exists "owner can select template doc types"       on practiceiq_service_template_doc_types;
drop policy if exists "owner can update template doc types"       on practiceiq_service_template_doc_types;
drop policy if exists "owner can delete service templates"        on practiceiq_service_templates;
drop policy if exists "owner can insert service templates"        on practiceiq_service_templates;
drop policy if exists "owner can select service templates"        on practiceiq_service_templates;
drop policy if exists "owner can update service templates"        on practiceiq_service_templates;
drop policy if exists "pq_settings_owner"                         on practiceiq_settings;
drop policy if exists "pq_tasks_owner"                            on practiceiq_tasks;
drop policy if exists "owner can delete telegram invites"         on practiceiq_telegram_invites;
drop policy if exists "owner can insert telegram invites"         on practiceiq_telegram_invites;
drop policy if exists "owner can select telegram invites"         on practiceiq_telegram_invites;
drop policy if exists "owner can update telegram invites"         on practiceiq_telegram_invites;

-- ===== 3. PK swap on firm-level config tables. =====
do $$ begin
  if exists (select 1 from pg_constraint where conname = 'practiceiq_settings_pkey') then
    alter table practiceiq_settings drop constraint practiceiq_settings_pkey;
  end if;
end$$;
alter table practiceiq_settings drop column if exists owner_user_id;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'practiceiq_settings_pkey') then
    alter table practiceiq_settings add primary key (firm_id);
  end if;
end$$;

do $$ begin
  if exists (select 1 from pg_constraint where conname = 'practiceiq_gmail_credentials_pkey') then
    alter table practiceiq_gmail_credentials drop constraint practiceiq_gmail_credentials_pkey;
  end if;
end$$;
alter table practiceiq_gmail_credentials drop column if exists owner_user_id;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'practiceiq_gmail_credentials_pkey') then
    alter table practiceiq_gmail_credentials add primary key (firm_id);
  end if;
end$$;

alter table practiceiq_ca_telegram_setup drop column if exists owner_user_id;

-- ===== 4. firm_id FKs to practiceiq_firms. =====
do $$ declare r record;
begin
  for r in
    select unnest(array[
      'practiceiq_clients','practiceiq_tasks','practiceiq_invoices','practiceiq_documents',
      'practiceiq_service_templates','practiceiq_service_template_doc_types',
      'practiceiq_client_services','practiceiq_client_service_doc_types',
      'practiceiq_client_emails','practiceiq_client_telegram_accounts',
      'practiceiq_telegram_invites','practiceiq_messages','practiceiq_emails',
      'practiceiq_document_checklist','practiceiq_document_status','practiceiq_followup_log',
      'practiceiq_settings','practiceiq_gmail_credentials','practiceiq_ca_telegram_setup'
    ]) as table_name
  loop
    if not exists (select 1 from pg_constraint where conname = r.table_name || '_firm_fk') then
      execute format(
        'alter table %I add constraint %I foreign key (firm_id) references practiceiq_firms(id) on delete cascade',
        r.table_name, r.table_name || '_firm_fk'
      );
    end if;
  end loop;
end$$;

-- ===== 5. New firm-keyed RLS policies. =====
-- (Every authenticated user in a firm can SELECT/INSERT/UPDATE/DELETE rows of
--  that firm in Mission 0.1. Role-based restriction comes in 0.2/1.x.)

create policy practiceiq_clients_firm_select on practiceiq_clients for select using (firm_id in (select user_firm_ids()));
create policy practiceiq_clients_firm_insert on practiceiq_clients for insert with check (firm_id in (select user_firm_ids()));
create policy practiceiq_clients_firm_update on practiceiq_clients for update using (firm_id in (select user_firm_ids())) with check (firm_id in (select user_firm_ids()));
create policy practiceiq_clients_firm_delete on practiceiq_clients for delete using (firm_id in (select user_firm_ids()));

create policy practiceiq_tasks_firm_select on practiceiq_tasks for select using (firm_id in (select user_firm_ids()));
create policy practiceiq_tasks_firm_insert on practiceiq_tasks for insert with check (firm_id in (select user_firm_ids()));
create policy practiceiq_tasks_firm_update on practiceiq_tasks for update using (firm_id in (select user_firm_ids())) with check (firm_id in (select user_firm_ids()));
create policy practiceiq_tasks_firm_delete on practiceiq_tasks for delete using (firm_id in (select user_firm_ids()));

create policy practiceiq_invoices_firm_select on practiceiq_invoices for select using (firm_id in (select user_firm_ids()));
create policy practiceiq_invoices_firm_insert on practiceiq_invoices for insert with check (firm_id in (select user_firm_ids()));
create policy practiceiq_invoices_firm_update on practiceiq_invoices for update using (firm_id in (select user_firm_ids())) with check (firm_id in (select user_firm_ids()));
create policy practiceiq_invoices_firm_delete on practiceiq_invoices for delete using (firm_id in (select user_firm_ids()));

create policy practiceiq_documents_firm_select on practiceiq_documents for select using (firm_id in (select user_firm_ids()));
create policy practiceiq_documents_firm_insert on practiceiq_documents for insert with check (firm_id in (select user_firm_ids()));
create policy practiceiq_documents_firm_update on practiceiq_documents for update using (firm_id in (select user_firm_ids())) with check (firm_id in (select user_firm_ids()));
create policy practiceiq_documents_firm_delete on practiceiq_documents for delete using (firm_id in (select user_firm_ids()));

create policy practiceiq_service_templates_firm_select on practiceiq_service_templates for select using (firm_id in (select user_firm_ids()));
create policy practiceiq_service_templates_firm_insert on practiceiq_service_templates for insert with check (firm_id in (select user_firm_ids()));
create policy practiceiq_service_templates_firm_update on practiceiq_service_templates for update using (firm_id in (select user_firm_ids())) with check (firm_id in (select user_firm_ids()));
create policy practiceiq_service_templates_firm_delete on practiceiq_service_templates for delete using (firm_id in (select user_firm_ids()));

create policy practiceiq_stdt_firm_select on practiceiq_service_template_doc_types for select using (firm_id in (select user_firm_ids()));
create policy practiceiq_stdt_firm_insert on practiceiq_service_template_doc_types for insert with check (firm_id in (select user_firm_ids()));
create policy practiceiq_stdt_firm_update on practiceiq_service_template_doc_types for update using (firm_id in (select user_firm_ids())) with check (firm_id in (select user_firm_ids()));
create policy practiceiq_stdt_firm_delete on practiceiq_service_template_doc_types for delete using (firm_id in (select user_firm_ids()));

create policy practiceiq_client_services_firm_select on practiceiq_client_services for select using (firm_id in (select user_firm_ids()));
create policy practiceiq_client_services_firm_insert on practiceiq_client_services for insert with check (firm_id in (select user_firm_ids()));
create policy practiceiq_client_services_firm_update on practiceiq_client_services for update using (firm_id in (select user_firm_ids())) with check (firm_id in (select user_firm_ids()));
create policy practiceiq_client_services_firm_delete on practiceiq_client_services for delete using (firm_id in (select user_firm_ids()));

create policy practiceiq_csdt_firm_select on practiceiq_client_service_doc_types for select using (firm_id in (select user_firm_ids()));
create policy practiceiq_csdt_firm_insert on practiceiq_client_service_doc_types for insert with check (firm_id in (select user_firm_ids()));
create policy practiceiq_csdt_firm_update on practiceiq_client_service_doc_types for update using (firm_id in (select user_firm_ids())) with check (firm_id in (select user_firm_ids()));
create policy practiceiq_csdt_firm_delete on practiceiq_client_service_doc_types for delete using (firm_id in (select user_firm_ids()));

create policy practiceiq_client_emails_firm_select on practiceiq_client_emails for select using (firm_id in (select user_firm_ids()));
create policy practiceiq_client_emails_firm_insert on practiceiq_client_emails for insert with check (firm_id in (select user_firm_ids()));
create policy practiceiq_client_emails_firm_update on practiceiq_client_emails for update using (firm_id in (select user_firm_ids())) with check (firm_id in (select user_firm_ids()));
create policy practiceiq_client_emails_firm_delete on practiceiq_client_emails for delete using (firm_id in (select user_firm_ids()));

create policy practiceiq_cta_firm_select on practiceiq_client_telegram_accounts for select using (firm_id in (select user_firm_ids()));
create policy practiceiq_cta_firm_insert on practiceiq_client_telegram_accounts for insert with check (firm_id in (select user_firm_ids()));
create policy practiceiq_cta_firm_update on practiceiq_client_telegram_accounts for update using (firm_id in (select user_firm_ids())) with check (firm_id in (select user_firm_ids()));
create policy practiceiq_cta_firm_delete on practiceiq_client_telegram_accounts for delete using (firm_id in (select user_firm_ids()));

create policy practiceiq_ti_firm_select on practiceiq_telegram_invites for select using (firm_id in (select user_firm_ids()));
create policy practiceiq_ti_firm_insert on practiceiq_telegram_invites for insert with check (firm_id in (select user_firm_ids()));
create policy practiceiq_ti_firm_update on practiceiq_telegram_invites for update using (firm_id in (select user_firm_ids())) with check (firm_id in (select user_firm_ids()));
create policy practiceiq_ti_firm_delete on practiceiq_telegram_invites for delete using (firm_id in (select user_firm_ids()));

create policy practiceiq_messages_firm_select on practiceiq_messages for select using (firm_id in (select user_firm_ids()));
create policy practiceiq_messages_firm_insert on practiceiq_messages for insert with check (firm_id in (select user_firm_ids()));
create policy practiceiq_messages_firm_update on practiceiq_messages for update using (firm_id in (select user_firm_ids())) with check (firm_id in (select user_firm_ids()));
create policy practiceiq_messages_firm_delete on practiceiq_messages for delete using (firm_id in (select user_firm_ids()));

create policy practiceiq_emails_firm_select on practiceiq_emails for select using (firm_id in (select user_firm_ids()));
create policy practiceiq_emails_firm_update on practiceiq_emails for update using (firm_id in (select user_firm_ids())) with check (firm_id in (select user_firm_ids()));

create policy practiceiq_dc_firm_select on practiceiq_document_checklist for select using (firm_id in (select user_firm_ids()));
create policy practiceiq_dc_firm_insert on practiceiq_document_checklist for insert with check (firm_id in (select user_firm_ids()));
create policy practiceiq_dc_firm_update on practiceiq_document_checklist for update using (firm_id in (select user_firm_ids())) with check (firm_id in (select user_firm_ids()));
create policy practiceiq_dc_firm_delete on practiceiq_document_checklist for delete using (firm_id in (select user_firm_ids()));

create policy practiceiq_ds_firm_select on practiceiq_document_status for select using (firm_id in (select user_firm_ids()));
create policy practiceiq_ds_firm_insert on practiceiq_document_status for insert with check (firm_id in (select user_firm_ids()));
create policy practiceiq_ds_firm_update on practiceiq_document_status for update using (firm_id in (select user_firm_ids())) with check (firm_id in (select user_firm_ids()));
create policy practiceiq_ds_firm_delete on practiceiq_document_status for delete using (firm_id in (select user_firm_ids()));

create policy practiceiq_fl_firm_select on practiceiq_followup_log for select using (firm_id in (select user_firm_ids()));
create policy practiceiq_fl_firm_insert on practiceiq_followup_log for insert with check (firm_id in (select user_firm_ids()));
create policy practiceiq_fl_firm_update on practiceiq_followup_log for update using (firm_id in (select user_firm_ids())) with check (firm_id in (select user_firm_ids()));
create policy practiceiq_fl_firm_delete on practiceiq_followup_log for delete using (firm_id in (select user_firm_ids()));

create policy practiceiq_settings_firm_select on practiceiq_settings for select using (firm_id in (select user_firm_ids()));
create policy practiceiq_settings_firm_insert on practiceiq_settings for insert with check (firm_id in (select user_firm_ids()));
create policy practiceiq_settings_firm_update on practiceiq_settings for update using (firm_id in (select user_firm_ids())) with check (firm_id in (select user_firm_ids()));

create policy practiceiq_gc_firm_select on practiceiq_gmail_credentials for select using (firm_id in (select user_firm_ids()));

create policy practiceiq_cts_firm_select on practiceiq_ca_telegram_setup for select using (firm_id in (select user_firm_ids()));
create policy practiceiq_cts_firm_insert on practiceiq_ca_telegram_setup for insert with check (firm_id in (select user_firm_ids()));
create policy practiceiq_cts_firm_delete on practiceiq_ca_telegram_setup for delete using (firm_id in (select user_firm_ids()));

-- ===== 6. RLS on the three new tables. =====
alter table practiceiq_firms enable row level security;
alter table practiceiq_firm_users enable row level security;
alter table practiceiq_firm_invites enable row level security;

create policy practiceiq_firms_firm_select on practiceiq_firms
  for select using (id in (select user_firm_ids()));
create policy practiceiq_firms_admin_update on practiceiq_firms
  for update using (
    exists (select 1 from practiceiq_firm_users
            where firm_id = practiceiq_firms.id and user_id = auth.uid() and role = 'admin')
  ) with check (
    exists (select 1 from practiceiq_firm_users
            where firm_id = practiceiq_firms.id and user_id = auth.uid() and role = 'admin')
  );

create policy practiceiq_firm_users_firm_select on practiceiq_firm_users
  for select using (firm_id in (select user_firm_ids()));
create policy practiceiq_firm_users_admin_insert on practiceiq_firm_users
  for insert with check (
    exists (select 1 from practiceiq_firm_users fu
            where fu.firm_id = practiceiq_firm_users.firm_id and fu.user_id = auth.uid() and fu.role = 'admin')
  );
create policy practiceiq_firm_users_admin_update on practiceiq_firm_users
  for update using (
    exists (select 1 from practiceiq_firm_users fu
            where fu.firm_id = practiceiq_firm_users.firm_id and fu.user_id = auth.uid() and fu.role = 'admin')
  );
create policy practiceiq_firm_users_admin_delete on practiceiq_firm_users
  for delete using (
    exists (select 1 from practiceiq_firm_users fu
            where fu.firm_id = practiceiq_firm_users.firm_id and fu.user_id = auth.uid() and fu.role = 'admin')
  );

create policy practiceiq_firm_invites_admin_select on practiceiq_firm_invites
  for select using (
    exists (select 1 from practiceiq_firm_users
            where firm_id = practiceiq_firm_invites.firm_id and user_id = auth.uid() and role = 'admin')
  );
create policy practiceiq_firm_invites_admin_insert on practiceiq_firm_invites
  for insert with check (
    exists (select 1 from practiceiq_firm_users
            where firm_id = practiceiq_firm_invites.firm_id and user_id = auth.uid() and role = 'admin')
  );
create policy practiceiq_firm_invites_admin_delete on practiceiq_firm_invites
  for delete using (
    exists (select 1 from practiceiq_firm_users
            where firm_id = practiceiq_firm_invites.firm_id and user_id = auth.uid() and role = 'admin')
  );
