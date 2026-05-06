-- Replace the firm-only RLS policies on tasks/clients/documents/invoices with
-- module-permission AND restricted-client checks.
--
-- Read predicate:
--   firm_id in user_firm_ids()
--   AND user_can_read(<module>)
--   AND (user_restricted_client_ids() is null OR client_id = any(user_restricted_client_ids()))
--
-- Write predicate (insert/update/delete) flips can_read → can_write.
--
-- For practiceiq_clients the client column is `id` (not `client_id`).
-- For tasks/documents/invoices, restricted users only see rows whose
-- client_id is non-null AND in their assignments — firm-level rows with no
-- client are hidden from restricted staff.

-- ===== practiceiq_clients =====
drop policy if exists practiceiq_clients_firm_select on practiceiq_clients;
drop policy if exists practiceiq_clients_firm_insert on practiceiq_clients;
drop policy if exists practiceiq_clients_firm_update on practiceiq_clients;
drop policy if exists practiceiq_clients_firm_delete on practiceiq_clients;

create policy practiceiq_clients_rbac_select on practiceiq_clients
  for select using (
    firm_id in (select user_firm_ids())
    and user_can_read('clients')
    and (user_restricted_client_ids() is null or id = any(user_restricted_client_ids()))
  );
create policy practiceiq_clients_rbac_insert on practiceiq_clients
  for insert with check (
    firm_id in (select user_firm_ids())
    and user_can_write('clients')
    and (user_restricted_client_ids() is null or id = any(user_restricted_client_ids()))
  );
create policy practiceiq_clients_rbac_update on practiceiq_clients
  for update using (
    firm_id in (select user_firm_ids())
    and user_can_write('clients')
    and (user_restricted_client_ids() is null or id = any(user_restricted_client_ids()))
  ) with check (
    firm_id in (select user_firm_ids())
    and user_can_write('clients')
    and (user_restricted_client_ids() is null or id = any(user_restricted_client_ids()))
  );
create policy practiceiq_clients_rbac_delete on practiceiq_clients
  for delete using (
    firm_id in (select user_firm_ids())
    and user_can_write('clients')
    and (user_restricted_client_ids() is null or id = any(user_restricted_client_ids()))
  );

-- ===== practiceiq_tasks =====
drop policy if exists practiceiq_tasks_firm_select on practiceiq_tasks;
drop policy if exists practiceiq_tasks_firm_insert on practiceiq_tasks;
drop policy if exists practiceiq_tasks_firm_update on practiceiq_tasks;
drop policy if exists practiceiq_tasks_firm_delete on practiceiq_tasks;

create policy practiceiq_tasks_rbac_select on practiceiq_tasks
  for select using (
    firm_id in (select user_firm_ids())
    and user_can_read('tasks')
    and (
      user_restricted_client_ids() is null
      or (client_id is not null and client_id = any(user_restricted_client_ids()))
    )
  );
create policy practiceiq_tasks_rbac_insert on practiceiq_tasks
  for insert with check (
    firm_id in (select user_firm_ids())
    and user_can_write('tasks')
    and (
      user_restricted_client_ids() is null
      or (client_id is not null and client_id = any(user_restricted_client_ids()))
    )
  );
create policy practiceiq_tasks_rbac_update on practiceiq_tasks
  for update using (
    firm_id in (select user_firm_ids())
    and user_can_write('tasks')
    and (
      user_restricted_client_ids() is null
      or (client_id is not null and client_id = any(user_restricted_client_ids()))
    )
  ) with check (
    firm_id in (select user_firm_ids())
    and user_can_write('tasks')
    and (
      user_restricted_client_ids() is null
      or (client_id is not null and client_id = any(user_restricted_client_ids()))
    )
  );
create policy practiceiq_tasks_rbac_delete on practiceiq_tasks
  for delete using (
    firm_id in (select user_firm_ids())
    and user_can_write('tasks')
    and (
      user_restricted_client_ids() is null
      or (client_id is not null and client_id = any(user_restricted_client_ids()))
    )
  );

-- ===== practiceiq_invoices =====
drop policy if exists practiceiq_invoices_firm_select on practiceiq_invoices;
drop policy if exists practiceiq_invoices_firm_insert on practiceiq_invoices;
drop policy if exists practiceiq_invoices_firm_update on practiceiq_invoices;
drop policy if exists practiceiq_invoices_firm_delete on practiceiq_invoices;

create policy practiceiq_invoices_rbac_select on practiceiq_invoices
  for select using (
    firm_id in (select user_firm_ids())
    and user_can_read('invoices')
    and (
      user_restricted_client_ids() is null
      or (client_id is not null and client_id = any(user_restricted_client_ids()))
    )
  );
create policy practiceiq_invoices_rbac_insert on practiceiq_invoices
  for insert with check (
    firm_id in (select user_firm_ids())
    and user_can_write('invoices')
    and (
      user_restricted_client_ids() is null
      or (client_id is not null and client_id = any(user_restricted_client_ids()))
    )
  );
create policy practiceiq_invoices_rbac_update on practiceiq_invoices
  for update using (
    firm_id in (select user_firm_ids())
    and user_can_write('invoices')
    and (
      user_restricted_client_ids() is null
      or (client_id is not null and client_id = any(user_restricted_client_ids()))
    )
  ) with check (
    firm_id in (select user_firm_ids())
    and user_can_write('invoices')
    and (
      user_restricted_client_ids() is null
      or (client_id is not null and client_id = any(user_restricted_client_ids()))
    )
  );
create policy practiceiq_invoices_rbac_delete on practiceiq_invoices
  for delete using (
    firm_id in (select user_firm_ids())
    and user_can_write('invoices')
    and (
      user_restricted_client_ids() is null
      or (client_id is not null and client_id = any(user_restricted_client_ids()))
    )
  );

-- ===== practiceiq_documents =====
drop policy if exists practiceiq_documents_firm_select on practiceiq_documents;
drop policy if exists practiceiq_documents_firm_insert on practiceiq_documents;
drop policy if exists practiceiq_documents_firm_update on practiceiq_documents;
drop policy if exists practiceiq_documents_firm_delete on practiceiq_documents;

create policy practiceiq_documents_rbac_select on practiceiq_documents
  for select using (
    firm_id in (select user_firm_ids())
    and user_can_read('documents')
    and (
      user_restricted_client_ids() is null
      or (client_id is not null and client_id = any(user_restricted_client_ids()))
    )
  );
create policy practiceiq_documents_rbac_insert on practiceiq_documents
  for insert with check (
    firm_id in (select user_firm_ids())
    and user_can_write('documents')
    and (
      user_restricted_client_ids() is null
      or (client_id is not null and client_id = any(user_restricted_client_ids()))
    )
  );
create policy practiceiq_documents_rbac_update on practiceiq_documents
  for update using (
    firm_id in (select user_firm_ids())
    and user_can_write('documents')
    and (
      user_restricted_client_ids() is null
      or (client_id is not null and client_id = any(user_restricted_client_ids()))
    )
  ) with check (
    firm_id in (select user_firm_ids())
    and user_can_write('documents')
    and (
      user_restricted_client_ids() is null
      or (client_id is not null and client_id = any(user_restricted_client_ids()))
    )
  );
create policy practiceiq_documents_rbac_delete on practiceiq_documents
  for delete using (
    firm_id in (select user_firm_ids())
    and user_can_write('documents')
    and (
      user_restricted_client_ids() is null
      or (client_id is not null and client_id = any(user_restricted_client_ids()))
    )
  );
