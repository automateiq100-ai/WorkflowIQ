-- Backfill default roles per firm + link existing firm_users to their system role.
-- Defines a reusable helper `seed_default_roles_for_firm(uuid)` that bootstrapFirmForUser
-- in lib/practiceiq/auth.ts also calls when a brand-new firm is created.

create or replace function seed_default_roles_for_firm(p_firm_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_role uuid;
  v_dept_head_role uuid;
  v_staff_role uuid;
  v_hr_admin_role uuid;
begin
  -- Admin: full access to everything.
  insert into practiceiq_roles (firm_id, name, description, is_system, system_key, restrict_to_assigned_clients)
    values (p_firm_id, 'Admin', 'Full access to every module and admin settings.', true, 'admin', false)
    on conflict (firm_id, name) do update set description = excluded.description, is_system = true
    returning id into v_admin_role;

  insert into practiceiq_role_permissions (role_id, module, can_read, can_write)
    select v_admin_role, m, true, true
    from unnest(array['dashboard','clients','services','calendar','tasks','documents','invoices','hrms','hrms_admin','admin','reports']) m
    on conflict (role_id, module) do update set can_read = true, can_write = true;

  -- Department Head: full functional access, no admin pages.
  insert into practiceiq_roles (firm_id, name, description, is_system, system_key, restrict_to_assigned_clients)
    values (p_firm_id, 'Department Head', 'Manages a team and clients; cannot access firm admin or HR admin.', true, 'dept_head', false)
    on conflict (firm_id, name) do update set description = excluded.description, is_system = true
    returning id into v_dept_head_role;

  insert into practiceiq_role_permissions (role_id, module, can_read, can_write)
    select v_dept_head_role, m, true, true
    from unnest(array['dashboard','clients','services','calendar','tasks','documents','invoices','hrms','reports']) m
    on conflict (role_id, module) do update set can_read = excluded.can_read, can_write = excluded.can_write;
  insert into practiceiq_role_permissions (role_id, module, can_read, can_write)
    select v_dept_head_role, m, false, false
    from unnest(array['admin','hrms_admin']) m
    on conflict (role_id, module) do update set can_read = excluded.can_read, can_write = excluded.can_write;

  -- Staff: read most, write on tasks + documents + own HRMS.
  insert into practiceiq_roles (firm_id, name, description, is_system, system_key, restrict_to_assigned_clients)
    values (p_firm_id, 'Staff', 'Operational team member. Read access to assigned data; can update tasks and own HRMS records.', true, 'staff', false)
    on conflict (firm_id, name) do update set description = excluded.description, is_system = true
    returning id into v_staff_role;

  insert into practiceiq_role_permissions (role_id, module, can_read, can_write) values
    (v_staff_role, 'dashboard', true,  false),
    (v_staff_role, 'clients',   true,  false),
    (v_staff_role, 'services',  true,  false),
    (v_staff_role, 'calendar',  true,  false),
    (v_staff_role, 'tasks',     true,  true),
    (v_staff_role, 'documents', true,  true),
    (v_staff_role, 'invoices',  true,  false),
    (v_staff_role, 'hrms',      true,  true),
    (v_staff_role, 'hrms_admin',false, false),
    (v_staff_role, 'admin',     false, false),
    (v_staff_role, 'reports',   true,  false)
    on conflict (role_id, module) do update set can_read = excluded.can_read, can_write = excluded.can_write;

  -- HR Admin: HRMS-only.
  insert into practiceiq_roles (firm_id, name, description, is_system, system_key, restrict_to_assigned_clients)
    values (p_firm_id, 'HR Admin', 'Manages employees, attendance, leaves, expenses, timesheets, and HR reports.', true, 'hr_admin', false)
    on conflict (firm_id, name) do update set description = excluded.description, is_system = true
    returning id into v_hr_admin_role;

  insert into practiceiq_role_permissions (role_id, module, can_read, can_write) values
    (v_hr_admin_role, 'dashboard',  true,  false),
    (v_hr_admin_role, 'clients',    false, false),
    (v_hr_admin_role, 'services',   false, false),
    (v_hr_admin_role, 'calendar',   true,  false),
    (v_hr_admin_role, 'tasks',      false, false),
    (v_hr_admin_role, 'documents',  false, false),
    (v_hr_admin_role, 'invoices',   false, false),
    (v_hr_admin_role, 'hrms',       true,  true),
    (v_hr_admin_role, 'hrms_admin', true,  true),
    (v_hr_admin_role, 'admin',      false, false),
    (v_hr_admin_role, 'reports',    true,  false)
    on conflict (role_id, module) do update set can_read = excluded.can_read, can_write = excluded.can_write;
end;
$$;

-- Seed defaults for all existing firms (no-op when there are none).
do $$ declare r record;
begin
  for r in select id from practiceiq_firms loop
    perform seed_default_roles_for_firm(r.id);
  end loop;
end $$;

-- Link existing firm_users.role text → role_id of the matching system role.
update practiceiq_firm_users fu
set role_id = r.id
from practiceiq_roles r
where r.firm_id = fu.firm_id
  and r.is_system = true
  and r.system_key = fu.role
  and fu.role_id is null;
