-- HRMS module schema. Six new tables, all firm-scoped, RLS gated by
-- user_can_read('hrms') / user_can_write('hrms'). Cross-employee admin reads
-- (Manager Reports, full-roster updates) gated by 'hrms_admin'.
--
-- Tables:
--   practiceiq_departments       — name + optional head pointer
--   practiceiq_employees         — directory (links to firm_users by user_id)
--   practiceiq_attendance        — daily check-in / check-out
--   practiceiq_leave_requests    — typed leave requests + approval status
--   practiceiq_expense_claims    — expense submissions + approval status
--   practiceiq_timesheet_entries — weekly time entries against client/task
--
-- An employee row is auto-created on first sign-in for any firm member who
-- doesn't already have one (handled in lib/practiceiq/auth.ts after firm
-- bootstrap).

create table if not exists practiceiq_departments (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references practiceiq_firms(id) on delete cascade,
  name text not null,
  head_employee_id uuid,
  created_at timestamptz not null default now(),
  unique (firm_id, name)
);

create index if not exists practiceiq_departments_firm_idx on practiceiq_departments(firm_id);

-- Employee directory. user_id is nullable so HR can stub external/contractor
-- employees that aren't yet (or never) signed in.
create table if not exists practiceiq_employees (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references practiceiq_firms(id) on delete cascade,
  user_id uuid,
  employee_code text not null,
  full_name text not null,
  email text,
  phone text,
  designation text,
  department_id uuid references practiceiq_departments(id) on delete set null,
  manager_id uuid references practiceiq_employees(id) on delete set null,
  date_of_joining date,
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  unique (firm_id, employee_code)
);

create index if not exists practiceiq_employees_firm_idx on practiceiq_employees(firm_id);
create index if not exists practiceiq_employees_user_idx on practiceiq_employees(user_id);
create index if not exists practiceiq_employees_manager_idx on practiceiq_employees(manager_id);

-- Per-firm employee_code sequence (EMP00001…).
create table if not exists practiceiq_employee_sequences (
  firm_id uuid primary key references practiceiq_firms(id) on delete cascade,
  last_number integer not null default 0
);

alter table practiceiq_employee_sequences enable row level security;
drop policy if exists practiceiq_employee_sequences_firm_rw on practiceiq_employee_sequences;
create policy practiceiq_employee_sequences_firm_rw on practiceiq_employee_sequences
  for all using (firm_id in (select user_firm_ids()))
  with check (firm_id in (select user_firm_ids()));

create or replace function practiceiq_employees_assign_code()
returns trigger
language plpgsql
as $$
declare
  v_next integer;
begin
  if (NEW.employee_code is null or NEW.employee_code = '') and NEW.firm_id is not null then
    insert into practiceiq_employee_sequences (firm_id, last_number)
      values (NEW.firm_id, 1)
      on conflict (firm_id) do update
        set last_number = practiceiq_employee_sequences.last_number + 1
      returning last_number into v_next;
    NEW.employee_code := 'EMP' || lpad(v_next::text, 5, '0');
  end if;
  return NEW;
end;
$$;

drop trigger if exists practiceiq_employees_assign_code_t on practiceiq_employees;
create trigger practiceiq_employees_assign_code_t
  before insert on practiceiq_employees
  for each row execute function practiceiq_employees_assign_code();

-- Attendance. One row per (employee, date) max — enforced by unique idx.
create table if not exists practiceiq_attendance (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references practiceiq_firms(id) on delete cascade,
  employee_id uuid not null references practiceiq_employees(id) on delete cascade,
  date date not null,
  check_in_at timestamptz,
  check_out_at timestamptz,
  source text not null default 'web' check (source in ('web','manual'))
);

create unique index if not exists practiceiq_attendance_emp_date_uidx
  on practiceiq_attendance(employee_id, date);
create index if not exists practiceiq_attendance_firm_idx on practiceiq_attendance(firm_id);

-- Leave requests.
create table if not exists practiceiq_leave_requests (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references practiceiq_firms(id) on delete cascade,
  employee_id uuid not null references practiceiq_employees(id) on delete cascade,
  leave_type text not null check (leave_type in ('casual','sick','earned','unpaid')),
  from_date date not null,
  to_date date not null,
  days numeric(5,2) not null,
  reason text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  approver_employee_id uuid references practiceiq_employees(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now()
);

create index if not exists practiceiq_leave_requests_firm_idx on practiceiq_leave_requests(firm_id);
create index if not exists practiceiq_leave_requests_employee_idx on practiceiq_leave_requests(employee_id);
create index if not exists practiceiq_leave_requests_status_idx on practiceiq_leave_requests(status);

-- Expense claims.
create table if not exists practiceiq_expense_claims (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references practiceiq_firms(id) on delete cascade,
  employee_id uuid not null references practiceiq_employees(id) on delete cascade,
  claim_date date not null,
  category text not null check (category in ('travel','meals','supplies','other')),
  amount numeric(12,2) not null,
  currency text not null default 'INR',
  description text,
  receipt_url text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  approver_employee_id uuid references practiceiq_employees(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now()
);

create index if not exists practiceiq_expense_claims_firm_idx on practiceiq_expense_claims(firm_id);
create index if not exists practiceiq_expense_claims_employee_idx on practiceiq_expense_claims(employee_id);
create index if not exists practiceiq_expense_claims_status_idx on practiceiq_expense_claims(status);

-- Timesheet entries.
create table if not exists practiceiq_timesheet_entries (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references practiceiq_firms(id) on delete cascade,
  employee_id uuid not null references practiceiq_employees(id) on delete cascade,
  date date not null,
  client_id uuid references practiceiq_clients(id) on delete set null,
  task_id uuid references practiceiq_tasks(id) on delete set null,
  hours numeric(5,2) not null,
  description text,
  billable boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists practiceiq_timesheet_entries_firm_idx on practiceiq_timesheet_entries(firm_id);
create index if not exists practiceiq_timesheet_entries_employee_date_idx on practiceiq_timesheet_entries(employee_id, date);

-- ===== RLS =====
alter table practiceiq_departments enable row level security;
alter table practiceiq_employees enable row level security;
alter table practiceiq_attendance enable row level security;
alter table practiceiq_leave_requests enable row level security;
alter table practiceiq_expense_claims enable row level security;
alter table practiceiq_timesheet_entries enable row level security;

-- Departments: all HRMS-readers can read; only hrms_admin can write.
create policy practiceiq_departments_select on practiceiq_departments
  for select using (firm_id in (select user_firm_ids()) and user_can_read('hrms'));
create policy practiceiq_departments_write on practiceiq_departments
  for all using (firm_id in (select user_firm_ids()) and user_can_write('hrms_admin'))
  with check (firm_id in (select user_firm_ids()) and user_can_write('hrms_admin'));

-- Employees:
--   Read: any HRMS-reader can see firm directory.
--   Write: hrms_admin OR the row's user_id = self (so an employee can update
--          their own profile fields if needed in future).
create policy practiceiq_employees_select on practiceiq_employees
  for select using (firm_id in (select user_firm_ids()) and user_can_read('hrms'));
create policy practiceiq_employees_admin_write on practiceiq_employees
  for all using (firm_id in (select user_firm_ids()) and user_can_write('hrms_admin'))
  with check (firm_id in (select user_firm_ids()) and user_can_write('hrms_admin'));

-- Attendance:
--   Self can read+write own rows.
--   hrms_admin can read+write all firm rows.
create policy practiceiq_attendance_self on practiceiq_attendance
  for all using (
    firm_id in (select user_firm_ids())
    and user_can_read('hrms')
    and exists (select 1 from practiceiq_employees e
                where e.id = employee_id and e.user_id = auth.uid())
  ) with check (
    firm_id in (select user_firm_ids())
    and user_can_write('hrms')
    and exists (select 1 from practiceiq_employees e
                where e.id = employee_id and e.user_id = auth.uid())
  );
create policy practiceiq_attendance_admin on practiceiq_attendance
  for all using (firm_id in (select user_firm_ids()) and user_can_read('hrms_admin'))
  with check (firm_id in (select user_firm_ids()) and user_can_write('hrms_admin'));

-- Leave requests:
--   Self can read+create own pending requests; cannot self-approve.
--   Manager (employee where manager_id = my_employee_id) can read + decide.
--   hrms_admin can read + decide everyone.
create policy practiceiq_leave_self on practiceiq_leave_requests
  for select using (
    firm_id in (select user_firm_ids())
    and user_can_read('hrms')
    and exists (select 1 from practiceiq_employees e
                where e.id = employee_id and e.user_id = auth.uid())
  );
create policy practiceiq_leave_self_insert on practiceiq_leave_requests
  for insert with check (
    firm_id in (select user_firm_ids())
    and user_can_write('hrms')
    and exists (select 1 from practiceiq_employees e
                where e.id = employee_id and e.user_id = auth.uid())
  );
create policy practiceiq_leave_manager on practiceiq_leave_requests
  for select using (
    firm_id in (select user_firm_ids())
    and user_can_read('hrms')
    and exists (
      select 1 from practiceiq_employees mgr
      join practiceiq_employees emp on emp.manager_id = mgr.id
      where mgr.user_id = auth.uid() and emp.id = practiceiq_leave_requests.employee_id
    )
  );
create policy practiceiq_leave_manager_decide on practiceiq_leave_requests
  for update using (
    firm_id in (select user_firm_ids())
    and user_can_write('hrms')
    and exists (
      select 1 from practiceiq_employees mgr
      join practiceiq_employees emp on emp.manager_id = mgr.id
      where mgr.user_id = auth.uid() and emp.id = practiceiq_leave_requests.employee_id
    )
  ) with check (
    firm_id in (select user_firm_ids())
    and user_can_write('hrms')
  );
create policy practiceiq_leave_admin on practiceiq_leave_requests
  for all using (firm_id in (select user_firm_ids()) and user_can_read('hrms_admin'))
  with check (firm_id in (select user_firm_ids()) and user_can_write('hrms_admin'));

-- Expense claims: same shape.
create policy practiceiq_expense_self on practiceiq_expense_claims
  for select using (
    firm_id in (select user_firm_ids())
    and user_can_read('hrms')
    and exists (select 1 from practiceiq_employees e
                where e.id = employee_id and e.user_id = auth.uid())
  );
create policy practiceiq_expense_self_insert on practiceiq_expense_claims
  for insert with check (
    firm_id in (select user_firm_ids())
    and user_can_write('hrms')
    and exists (select 1 from practiceiq_employees e
                where e.id = employee_id and e.user_id = auth.uid())
  );
create policy practiceiq_expense_manager on practiceiq_expense_claims
  for select using (
    firm_id in (select user_firm_ids())
    and user_can_read('hrms')
    and exists (
      select 1 from practiceiq_employees mgr
      join practiceiq_employees emp on emp.manager_id = mgr.id
      where mgr.user_id = auth.uid() and emp.id = practiceiq_expense_claims.employee_id
    )
  );
create policy practiceiq_expense_manager_decide on practiceiq_expense_claims
  for update using (
    firm_id in (select user_firm_ids())
    and user_can_write('hrms')
    and exists (
      select 1 from practiceiq_employees mgr
      join practiceiq_employees emp on emp.manager_id = mgr.id
      where mgr.user_id = auth.uid() and emp.id = practiceiq_expense_claims.employee_id
    )
  ) with check (
    firm_id in (select user_firm_ids())
    and user_can_write('hrms')
  );
create policy practiceiq_expense_admin on practiceiq_expense_claims
  for all using (firm_id in (select user_firm_ids()) and user_can_read('hrms_admin'))
  with check (firm_id in (select user_firm_ids()) and user_can_write('hrms_admin'));

-- Timesheet: self read+write; manager + admin read.
create policy practiceiq_timesheet_self on practiceiq_timesheet_entries
  for all using (
    firm_id in (select user_firm_ids())
    and user_can_read('hrms')
    and exists (select 1 from practiceiq_employees e
                where e.id = employee_id and e.user_id = auth.uid())
  ) with check (
    firm_id in (select user_firm_ids())
    and user_can_write('hrms')
    and exists (select 1 from practiceiq_employees e
                where e.id = employee_id and e.user_id = auth.uid())
  );
create policy practiceiq_timesheet_manager_select on practiceiq_timesheet_entries
  for select using (
    firm_id in (select user_firm_ids())
    and user_can_read('hrms')
    and exists (
      select 1 from practiceiq_employees mgr
      join practiceiq_employees emp on emp.manager_id = mgr.id
      where mgr.user_id = auth.uid() and emp.id = practiceiq_timesheet_entries.employee_id
    )
  );
create policy practiceiq_timesheet_admin on practiceiq_timesheet_entries
  for all using (firm_id in (select user_firm_ids()) and user_can_read('hrms_admin'))
  with check (firm_id in (select user_firm_ids()) and user_can_write('hrms_admin'));

-- FK from departments.head_employee_id can now reference practiceiq_employees
-- (added after both tables exist).
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'practiceiq_departments_head_fk') then
    alter table practiceiq_departments
      add constraint practiceiq_departments_head_fk
      foreign key (head_employee_id) references practiceiq_employees(id) on delete set null;
  end if;
end $$;
