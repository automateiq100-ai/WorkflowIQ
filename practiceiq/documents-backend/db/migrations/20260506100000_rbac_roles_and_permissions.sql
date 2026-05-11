-- RBAC: custom roles + per-module permissions + per-client assignments.
-- Builds on phase0 firm tenancy. After this migration:
--   - practiceiq_roles holds firm-scoped roles (system + custom)
--   - practiceiq_role_permissions is a (role, module) grid with read/write flags
--   - practiceiq_user_client_assignments restricts which client rows a member
--     can see when their role has restrict_to_assigned_clients = true
--   - practiceiq_firm_users gains role_id; legacy `role` text kept in sync via trigger
--   - SQL helpers: user_role_id(), user_can_read(module), user_can_write(module),
--     user_restricted_client_ids() (returns NULL = unrestricted)
--
-- Backfill of default roles and the firm_users.role_id linkage runs in 20260506100100.
-- RLS swap (using the new helpers) runs in 20260506100200.

create table practiceiq_roles (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references practiceiq_firms(id) on delete cascade,
  name text not null,
  description text,
  is_system boolean not null default false,
  -- system_key matches the legacy role text ('admin','dept_head','staff','hr_admin')
  -- when is_system = true. NULL for custom roles.
  system_key text,
  restrict_to_assigned_clients boolean not null default false,
  created_at timestamptz not null default now(),
  unique (firm_id, name)
);

create index practiceiq_roles_firm_idx on practiceiq_roles(firm_id);

-- Modules whitelist (kept in CHECK so adding new modules is a one-line migration).
create table practiceiq_role_permissions (
  role_id uuid not null references practiceiq_roles(id) on delete cascade,
  module text not null check (module in (
    'dashboard','clients','services','calendar','tasks','documents',
    'invoices','hrms','hrms_admin','admin','reports'
  )),
  can_read boolean not null default false,
  can_write boolean not null default false,
  primary key (role_id, module)
);

create index practiceiq_role_permissions_role_idx on practiceiq_role_permissions(role_id);

-- Per-user client assignments. When the user's role.restrict_to_assigned_clients
-- is true, only clients in this table are visible (and tasks/documents/invoices
-- whose client_id matches). Otherwise this table is ignored.
create table practiceiq_user_client_assignments (
  firm_id uuid not null references practiceiq_firms(id) on delete cascade,
  user_id uuid not null,
  client_id uuid not null references practiceiq_clients(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  assigned_by uuid,
  primary key (user_id, client_id)
);

create index practiceiq_user_client_assignments_firm_idx on practiceiq_user_client_assignments(firm_id);
create index practiceiq_user_client_assignments_user_idx on practiceiq_user_client_assignments(user_id);

-- Add role_id to practiceiq_firm_users. Stays nullable until backfill migration
-- 20260506100100 populates it; we keep the legacy `role` text column for display
-- and to seed system_key on first sign-in.
alter table practiceiq_firm_users add column role_id uuid references practiceiq_roles(id) on delete set null;
create index practiceiq_firm_users_role_id_idx on practiceiq_firm_users(role_id);

-- ===== Helpers =====
-- All `select 1 from practiceiq_firm_users where ... auth.uid()` patterns wrap
-- the look-up in a SECURITY DEFINER function so we don't recursively hit RLS
-- on practiceiq_firm_users from a policy on the same table.

create or replace function user_role_id() returns uuid
language sql security invoker stable
as $$
  select role_id from practiceiq_firm_users
  where user_id = auth.uid()
  limit 1;
$$;

create or replace function user_can_read(p_module text) returns boolean
language sql security invoker stable
as $$
  select coalesce((
    select can_read from practiceiq_role_permissions
    where role_id = user_role_id() and module = p_module
    limit 1
  ), false);
$$;

create or replace function user_can_write(p_module text) returns boolean
language sql security invoker stable
as $$
  select coalesce((
    select can_write from practiceiq_role_permissions
    where role_id = user_role_id() and module = p_module
    limit 1
  ), false);
$$;

-- Returns the user's restriction state. When the role is unrestricted, returns
-- NULL (the calling RLS predicate treats NULL = "all clients visible"). When
-- the role is restricted but the user has no assignments yet, returns an empty
-- array (visible = none).
create or replace function user_restricted_client_ids() returns uuid[]
language sql security invoker stable
as $$
  select case
    when r.restrict_to_assigned_clients is not true then null
    else coalesce(array_agg(uca.client_id), array[]::uuid[])
  end
  from practiceiq_firm_users fu
  left join practiceiq_roles r on r.id = fu.role_id
  left join practiceiq_user_client_assignments uca on uca.user_id = fu.user_id
  where fu.user_id = auth.uid()
  group by r.restrict_to_assigned_clients
  limit 1;
$$;

-- Convenience: keep the legacy text `role` in sync with role.system_key
-- whenever role_id changes. Lets API code keep reading firm_users.role for
-- display purposes during the transition.
create or replace function practiceiq_firm_users_sync_role_text()
returns trigger
language plpgsql
as $$
begin
  if NEW.role_id is not null then
    select coalesce(r.system_key, r.name)
      into NEW.role
      from practiceiq_roles r
      where r.id = NEW.role_id;
  end if;
  return NEW;
end;
$$;

drop trigger if exists practiceiq_firm_users_sync_role_text_t on practiceiq_firm_users;
create trigger practiceiq_firm_users_sync_role_text_t
  before insert or update on practiceiq_firm_users
  for each row execute function practiceiq_firm_users_sync_role_text();

-- ===== RLS on the new tables =====
alter table practiceiq_roles enable row level security;
alter table practiceiq_role_permissions enable row level security;
alter table practiceiq_user_client_assignments enable row level security;

create policy practiceiq_roles_firm_select on practiceiq_roles
  for select using (firm_id in (select user_firm_ids()));
create policy practiceiq_roles_admin_insert on practiceiq_roles
  for insert with check (
    exists (select 1 from practiceiq_firm_users
            where firm_id = practiceiq_roles.firm_id and user_id = auth.uid() and role = 'admin')
  );
create policy practiceiq_roles_admin_update on practiceiq_roles
  for update using (
    exists (select 1 from practiceiq_firm_users
            where firm_id = practiceiq_roles.firm_id and user_id = auth.uid() and role = 'admin')
  ) with check (
    exists (select 1 from practiceiq_firm_users
            where firm_id = practiceiq_roles.firm_id and user_id = auth.uid() and role = 'admin')
  );
create policy practiceiq_roles_admin_delete on practiceiq_roles
  for delete using (
    is_system = false
    and exists (select 1 from practiceiq_firm_users
                where firm_id = practiceiq_roles.firm_id and user_id = auth.uid() and role = 'admin')
  );

create policy practiceiq_role_permissions_select on practiceiq_role_permissions
  for select using (
    exists (select 1 from practiceiq_roles r
            where r.id = role_id and r.firm_id in (select user_firm_ids()))
  );
create policy practiceiq_role_permissions_admin_write on practiceiq_role_permissions
  for all using (
    exists (select 1 from practiceiq_roles r
            join practiceiq_firm_users fu on fu.firm_id = r.firm_id
            where r.id = role_id and fu.user_id = auth.uid() and fu.role = 'admin')
  ) with check (
    exists (select 1 from practiceiq_roles r
            join practiceiq_firm_users fu on fu.firm_id = r.firm_id
            where r.id = role_id and fu.user_id = auth.uid() and fu.role = 'admin')
  );

create policy practiceiq_user_client_assignments_select on practiceiq_user_client_assignments
  for select using (
    firm_id in (select user_firm_ids())
    and (user_id = auth.uid() or exists (
      select 1 from practiceiq_firm_users fu
      where fu.firm_id = practiceiq_user_client_assignments.firm_id
            and fu.user_id = auth.uid() and fu.role = 'admin'
    ))
  );
create policy practiceiq_user_client_assignments_admin_write on practiceiq_user_client_assignments
  for all using (
    exists (select 1 from practiceiq_firm_users fu
            where fu.firm_id = practiceiq_user_client_assignments.firm_id
                  and fu.user_id = auth.uid() and fu.role = 'admin')
  ) with check (
    exists (select 1 from practiceiq_firm_users fu
            where fu.firm_id = practiceiq_user_client_assignments.firm_id
                  and fu.user_id = auth.uid() and fu.role = 'admin')
  );
