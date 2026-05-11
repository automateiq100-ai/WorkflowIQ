-- Tasks: add task_number (firm-scoped TSK#### sequence), service_type label,
-- chargeable flag, financial_year tag. Rename status value 'in_progress' →
-- 'processing' to match the screen reference. Backfill task_number in
-- created_at order.

-- New columns.
alter table practiceiq_tasks add column if not exists task_number integer;
alter table practiceiq_tasks add column if not exists service_type text;
alter table practiceiq_tasks add column if not exists chargeable boolean not null default true;
alter table practiceiq_tasks add column if not exists financial_year text;

-- Status text rename.
update practiceiq_tasks set status = 'processing' where status = 'in_progress';

-- Status CHECK (replace any existing one). The status column is text, not an
-- enum, in this DB.
do $$ declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'practiceiq_tasks'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table practiceiq_tasks drop constraint %I', c.conname);
  end loop;
end $$;
alter table practiceiq_tasks
  add constraint practiceiq_tasks_status_check
  check (status in ('open','processing','review','done'));

-- Per-firm sequence table.
create table if not exists practiceiq_task_sequences (
  firm_id uuid primary key references practiceiq_firms(id) on delete cascade,
  last_number integer not null default 0
);

alter table practiceiq_task_sequences enable row level security;
drop policy if exists practiceiq_task_sequences_firm_rw on practiceiq_task_sequences;
create policy practiceiq_task_sequences_firm_rw on practiceiq_task_sequences
  for all using (firm_id in (select user_firm_ids()))
  with check (firm_id in (select user_firm_ids()));

-- Trigger: assign next task_number per firm.
create or replace function practiceiq_tasks_assign_number()
returns trigger
language plpgsql
as $$
declare
  v_next integer;
begin
  if NEW.task_number is null and NEW.firm_id is not null then
    insert into practiceiq_task_sequences (firm_id, last_number)
      values (NEW.firm_id, 1)
      on conflict (firm_id) do update
        set last_number = practiceiq_task_sequences.last_number + 1
      returning last_number into v_next;
    NEW.task_number := v_next;
  end if;
  return NEW;
end;
$$;

drop trigger if exists practiceiq_tasks_assign_number_t on practiceiq_tasks;
create trigger practiceiq_tasks_assign_number_t
  before insert on practiceiq_tasks
  for each row execute function practiceiq_tasks_assign_number();

-- Backfill: assign task_number to existing rows in created_at order, per firm.
do $$ declare
  v_firm uuid;
  v_n integer;
  r record;
begin
  for v_firm in select distinct firm_id from practiceiq_tasks where task_number is null loop
    v_n := coalesce((select last_number from practiceiq_task_sequences where firm_id = v_firm), 0);
    for r in
      select id from practiceiq_tasks
      where firm_id = v_firm and task_number is null
      order by created_at nulls last, id
    loop
      v_n := v_n + 1;
      update practiceiq_tasks set task_number = v_n where id = r.id;
    end loop;
    insert into practiceiq_task_sequences (firm_id, last_number) values (v_firm, v_n)
      on conflict (firm_id) do update set last_number = greatest(practiceiq_task_sequences.last_number, excluded.last_number);
  end loop;
end $$;

create unique index if not exists practiceiq_tasks_firm_number_uidx
  on practiceiq_tasks(firm_id, task_number);
