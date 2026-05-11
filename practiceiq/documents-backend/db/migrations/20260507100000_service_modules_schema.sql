-- Two-level Services hierarchy: Module → Filing (existing service_templates row).
-- Adds:
--   - practiceiq_service_modules                   (the umbrella practice areas)
--   - module_id  on practiceiq_service_templates   (optional FK to module)
--   - module_id  on practiceiq_client_services     (mirror)
--   - is_system  on practiceiq_service_templates   (flag for seeded filings)
--   - seed_default_service_modules_for_firm(firm_id, owner_user_id) helper
--
-- Default modules + filings are inserted in 20260507100100; backfill of pre-
-- existing rows runs in 20260507100200.

create table if not exists practiceiq_service_modules (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references practiceiq_firms(id) on delete cascade,
  name text not null,
  code text not null,
  description text,
  icon text,
  color text,
  sort_order integer not null default 100,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  unique (firm_id, code)
);

create index if not exists practiceiq_service_modules_firm_idx
  on practiceiq_service_modules(firm_id);

-- Add module_id + is_system to templates and module_id to client services.
alter table practiceiq_service_templates
  add column if not exists module_id uuid references practiceiq_service_modules(id) on delete set null,
  add column if not exists is_system boolean not null default false;

create index if not exists practiceiq_service_templates_module_idx
  on practiceiq_service_templates(module_id);

alter table practiceiq_client_services
  add column if not exists module_id uuid references practiceiq_service_modules(id) on delete set null;

create index if not exists practiceiq_client_services_module_idx
  on practiceiq_client_services(module_id);

-- ===== RLS on the new modules table =====
alter table practiceiq_service_modules enable row level security;

drop policy if exists practiceiq_service_modules_firm_select on practiceiq_service_modules;
drop policy if exists practiceiq_service_modules_admin_insert on practiceiq_service_modules;
drop policy if exists practiceiq_service_modules_admin_update on practiceiq_service_modules;
drop policy if exists practiceiq_service_modules_admin_delete on practiceiq_service_modules;

create policy practiceiq_service_modules_firm_select on practiceiq_service_modules
  for select using (firm_id in (select user_firm_ids()));

create policy practiceiq_service_modules_admin_insert on practiceiq_service_modules
  for insert with check (
    exists (select 1 from practiceiq_firm_users
            where firm_id = practiceiq_service_modules.firm_id and user_id = auth.uid() and role = 'admin')
  );

create policy practiceiq_service_modules_admin_update on practiceiq_service_modules
  for update using (
    exists (select 1 from practiceiq_firm_users
            where firm_id = practiceiq_service_modules.firm_id and user_id = auth.uid() and role = 'admin')
  ) with check (
    exists (select 1 from practiceiq_firm_users
            where firm_id = practiceiq_service_modules.firm_id and user_id = auth.uid() and role = 'admin')
  );

create policy practiceiq_service_modules_admin_delete on practiceiq_service_modules
  for delete using (
    is_system = false
    and exists (select 1 from practiceiq_firm_users
                where firm_id = practiceiq_service_modules.firm_id and user_id = auth.uid() and role = 'admin')
  );
