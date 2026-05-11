-- Mirror of Supabase migration `document_status_add_period`
-- Applied via Supabase MCP on project qqcljfqkrslwqakjjrvw on 2026-05-04.
-- Source of truth is the Supabase project; this file exists for audit + DR replay.
--
-- Why: practiceiq_document_status tracked (client_id, doc_type, status) with no period,
-- so once a monthly doc was marked received it stayed received forever. Adding `period`
-- lets each filing period have its own status row. Same for the follow-up log.

alter table practiceiq_document_status add column if not exists period text;

do $$
begin
  if not exists (
    select 1 from pg_indexes
    where tablename = 'practiceiq_document_status'
      and indexname = 'practiceiq_document_status_unique_per_period'
  ) then
    create unique index practiceiq_document_status_unique_per_period
      on practiceiq_document_status(client_id, doc_type, period);
  end if;
end$$;

alter table practiceiq_followup_log add column if not exists period text;
