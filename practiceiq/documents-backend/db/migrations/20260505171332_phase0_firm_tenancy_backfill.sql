-- Mirror of Supabase migration `phase0_firm_tenancy_backfill`
-- Applied 2026-05-05 — Mission 0.1.B.
--
-- Why: For every distinct owner_user_id seen across tenant tables, create a
-- practiceiq_firms row, register the user as admin in practiceiq_firm_users,
-- then propagate firm_id to every tenant row.
--
-- Idempotent? No. Run once. Re-running would create duplicate firms.

do $$
declare
  uid uuid;
  fid uuid;
  fname text;
begin
  for uid in
    select distinct owner_user_id from (
      select owner_user_id from practiceiq_clients
      union select owner_user_id from practiceiq_tasks
      union select owner_user_id from practiceiq_invoices
      union select owner_user_id from practiceiq_documents
      union select owner_user_id from practiceiq_settings
      union select owner_user_id from practiceiq_service_templates
      union select owner_user_id from practiceiq_service_template_doc_types
      union select owner_user_id from practiceiq_client_services
      union select owner_user_id from practiceiq_client_service_doc_types
      union select owner_user_id from practiceiq_client_emails
      union select owner_user_id from practiceiq_client_telegram_accounts
      union select owner_user_id from practiceiq_telegram_invites
      union select owner_user_id from practiceiq_emails
      union select owner_user_id from practiceiq_gmail_credentials
      union select owner_user_id from practiceiq_ca_telegram_setup
    ) all_owners where owner_user_id is not null
  loop
    select coalesce(firm_name, 'My Firm') into fname
    from practiceiq_settings where owner_user_id = uid limit 1;
    if fname is null then fname := 'My Firm'; end if;

    insert into practiceiq_firms (name) values (fname) returning id into fid;
    insert into practiceiq_firm_users (firm_id, user_id, role) values (fid, uid, 'admin');

    update practiceiq_clients                       set firm_id = fid where owner_user_id = uid;
    update practiceiq_tasks                         set firm_id = fid where owner_user_id = uid;
    update practiceiq_invoices                      set firm_id = fid where owner_user_id = uid;
    update practiceiq_documents                     set firm_id = fid where owner_user_id = uid;
    update practiceiq_settings                      set firm_id = fid where owner_user_id = uid;
    update practiceiq_service_templates             set firm_id = fid where owner_user_id = uid;
    update practiceiq_service_template_doc_types    set firm_id = fid where owner_user_id = uid;
    update practiceiq_client_services               set firm_id = fid where owner_user_id = uid;
    update practiceiq_client_service_doc_types      set firm_id = fid where owner_user_id = uid;
    update practiceiq_client_emails                 set firm_id = fid where owner_user_id = uid;
    update practiceiq_client_telegram_accounts      set firm_id = fid where owner_user_id = uid;
    update practiceiq_telegram_invites              set firm_id = fid where owner_user_id = uid;
    update practiceiq_emails                        set firm_id = fid where owner_user_id = uid;
    update practiceiq_gmail_credentials             set firm_id = fid where owner_user_id = uid;
    update practiceiq_ca_telegram_setup             set firm_id = fid where owner_user_id = uid;
  end loop;
end$$;

update practiceiq_messages m
   set firm_id = c.firm_id
   from practiceiq_clients c
   where m.client_id = c.id and m.firm_id is null;

update practiceiq_document_checklist dc
   set firm_id = c.firm_id
   from practiceiq_clients c
   where dc.client_id = c.id and dc.firm_id is null;

update practiceiq_document_status ds
   set firm_id = c.firm_id
   from practiceiq_clients c
   where ds.client_id = c.id and ds.firm_id is null;

update practiceiq_followup_log fl
   set firm_id = c.firm_id
   from practiceiq_clients c
   where fl.client_id = c.id and fl.firm_id is null;
