-- Seed function: 16 standard CA-firm modules with their default filing types.
-- Caller passes firm_id + owner_user_id (used for the templates' owner_user_id
-- NOT NULL column). On first sign-in this is invoked from auth.ts via the
-- service-role client; for backfill across existing firms we look up the
-- firm's first admin user.

create or replace function seed_default_service_modules_for_firm(
  p_firm_id uuid,
  p_owner_user_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_module_id uuid;
  v_filing text;
  v_filings text[];
  v_cadence text;
begin
  -- Helper closure: insert a module + return its id (idempotent).
  -- We inline the insert for each module rather than using a temp table because
  -- the per-module filings list and cadence vary.

  -- ===== GST =====
  insert into practiceiq_service_modules (firm_id, name, code, description, icon, color, sort_order, is_system)
    values (p_firm_id, 'GST', 'GST', 'Goods & Services Tax — periodic returns and reconciliations.', '🧾', 'teal', 10, true)
    on conflict (firm_id, code) do update set is_system = true returning id into v_module_id;
  v_filings := array['GSTR-1','GSTR-1A','GSTR-3B','GSTR-4','GSTR-5','GSTR-6','GSTR-7','GSTR-8','GSTR-9','GSTR-9C','CMP-08','ITC-04','LUT','RFD-01'];
  foreach v_filing in array v_filings loop
    -- GSTR-9 / 9C are annual; CMP-08 / GSTR-4 quarterly; rest monthly.
    v_cadence := case
      when v_filing in ('GSTR-9','GSTR-9C','LUT') then 'annual'
      when v_filing in ('CMP-08','GSTR-4') then 'quarterly'
      else 'monthly'
    end;
    insert into practiceiq_service_templates (firm_id, owner_user_id, module_id, service, cadence, active, is_system)
      values (p_firm_id, p_owner_user_id, v_module_id, v_filing, v_cadence, true, true)
      on conflict do nothing;
  end loop;

  -- ===== TDS =====
  insert into practiceiq_service_modules (firm_id, name, code, description, icon, color, sort_order, is_system)
    values (p_firm_id, 'TDS / TCS', 'TDS', 'Tax Deducted/Collected at Source — quarterly returns and certificates.', '💰', 'amber', 20, true)
    on conflict (firm_id, code) do update set is_system = true returning id into v_module_id;
  v_filings := array['24Q','26Q','27Q','27EQ','Form 16','Form 16A','Form 27D'];
  foreach v_filing in array v_filings loop
    insert into practiceiq_service_templates (firm_id, owner_user_id, module_id, service, cadence, active, is_system)
      values (p_firm_id, p_owner_user_id, v_module_id, v_filing, 'quarterly', true, true)
      on conflict do nothing;
  end loop;

  -- ===== ITR =====
  insert into practiceiq_service_modules (firm_id, name, code, description, icon, color, sort_order, is_system)
    values (p_firm_id, 'Income Tax (ITR)', 'ITR', 'Income tax returns, advance tax and reconciliations.', '📄', 'blue', 30, true)
    on conflict (firm_id, code) do update set is_system = true returning id into v_module_id;
  v_filings := array['ITR-1','ITR-2','ITR-3','ITR-4','ITR-5','ITR-6','ITR-7','Advance Tax','Form 26AS reconciliation','Form 10E'];
  foreach v_filing in array v_filings loop
    v_cadence := case when v_filing = 'Advance Tax' then 'quarterly' else 'annual' end;
    insert into practiceiq_service_templates (firm_id, owner_user_id, module_id, service, cadence, active, is_system)
      values (p_firm_id, p_owner_user_id, v_module_id, v_filing, v_cadence, true, true)
      on conflict do nothing;
  end loop;

  -- ===== ROC / MCA =====
  insert into practiceiq_service_modules (firm_id, name, code, description, icon, color, sort_order, is_system)
    values (p_firm_id, 'ROC / MCA', 'ROC', 'Registrar of Companies & MCA filings.', '🏢', 'purple', 40, true)
    on conflict (firm_id, code) do update set is_system = true returning id into v_module_id;
  v_filings := array['AOC-4','MGT-7','MGT-7A','ADT-1','DPT-3','DIR-3 KYC','MGT-14','INC-22','BEN-2'];
  foreach v_filing in array v_filings loop
    insert into practiceiq_service_templates (firm_id, owner_user_id, module_id, service, cadence, active, is_system)
      values (p_firm_id, p_owner_user_id, v_module_id, v_filing, 'annual', true, true)
      on conflict do nothing;
  end loop;

  -- ===== AUDIT =====
  insert into practiceiq_service_modules (firm_id, name, code, description, icon, color, sort_order, is_system)
    values (p_firm_id, 'Audit', 'AUDIT', 'Statutory, tax, internal and specialised audits.', '🔍', 'red', 50, true)
    on conflict (firm_id, code) do update set is_system = true returning id into v_module_id;
  v_filings := array['Tax Audit (3CA-3CD)','Tax Audit (3CB-3CD)','Statutory Audit','Internal Audit','Stock Audit','Bank Audit','Concurrent Audit'];
  foreach v_filing in array v_filings loop
    insert into practiceiq_service_templates (firm_id, owner_user_id, module_id, service, cadence, active, is_system)
      values (p_firm_id, p_owner_user_id, v_module_id, v_filing, 'annual', true, true)
      on conflict do nothing;
  end loop;

  -- ===== PAYROLL =====
  insert into practiceiq_service_modules (firm_id, name, code, description, icon, color, sort_order, is_system)
    values (p_firm_id, 'Payroll', 'PAYROLL', 'Salary processing, payslips and statutory payroll filings.', '👥', 'coral', 60, true)
    on conflict (firm_id, code) do update set is_system = true returning id into v_module_id;
  v_filings := array['Salary Processing','Form 16','PF ECR','ESI Monthly','PT Monthly','Bonus Form D'];
  foreach v_filing in array v_filings loop
    v_cadence := case when v_filing in ('Form 16','Bonus Form D') then 'annual' else 'monthly' end;
    insert into practiceiq_service_templates (firm_id, owner_user_id, module_id, service, cadence, active, is_system)
      values (p_firm_id, p_owner_user_id, v_module_id, v_filing, v_cadence, true, true)
      on conflict do nothing;
  end loop;

  -- ===== PF / ESI =====
  insert into practiceiq_service_modules (firm_id, name, code, description, icon, color, sort_order, is_system)
    values (p_firm_id, 'PF / ESI', 'PF_ESI', 'Provident Fund and Employees State Insurance filings.', '🛡️', 'green', 70, true)
    on conflict (firm_id, code) do update set is_system = true returning id into v_module_id;
  v_filings := array['PF ECR','ESI Monthly Return','ESI Half-yearly','PF Annual Return'];
  foreach v_filing in array v_filings loop
    v_cadence := case when v_filing in ('ESI Half-yearly','PF Annual Return') then 'annual' else 'monthly' end;
    insert into practiceiq_service_templates (firm_id, owner_user_id, module_id, service, cadence, active, is_system)
      values (p_firm_id, p_owner_user_id, v_module_id, v_filing, v_cadence, true, true)
      on conflict do nothing;
  end loop;

  -- ===== PT (Professional Tax) =====
  insert into practiceiq_service_modules (firm_id, name, code, description, icon, color, sort_order, is_system)
    values (p_firm_id, 'Professional Tax', 'PT', 'State professional-tax registration and filings.', '📋', 'amber', 80, true)
    on conflict (firm_id, code) do update set is_system = true returning id into v_module_id;
  v_filings := array['Monthly PT','Annual PT','PT Registration'];
  foreach v_filing in array v_filings loop
    v_cadence := case
      when v_filing = 'Monthly PT' then 'monthly'
      when v_filing = 'Annual PT' then 'annual'
      else 'annual'
    end;
    insert into practiceiq_service_templates (firm_id, owner_user_id, module_id, service, cadence, active, is_system)
      values (p_firm_id, p_owner_user_id, v_module_id, v_filing, v_cadence, true, true)
      on conflict do nothing;
  end loop;

  -- ===== FEMA / RBI =====
  insert into practiceiq_service_modules (firm_id, name, code, description, icon, color, sort_order, is_system)
    values (p_firm_id, 'FEMA / RBI', 'FEMA', 'Foreign Exchange Management Act and RBI compliance.', '🌐', 'teal', 90, true)
    on conflict (firm_id, code) do update set is_system = true returning id into v_module_id;
  v_filings := array['FLA Return','FC-GPR','FC-TRS','ODI','APR (Annual Performance Report)'];
  foreach v_filing in array v_filings loop
    insert into practiceiq_service_templates (firm_id, owner_user_id, module_id, service, cadence, active, is_system)
      values (p_firm_id, p_owner_user_id, v_module_id, v_filing, 'annual', true, true)
      on conflict do nothing;
  end loop;

  -- ===== Form 15CA / 15CB =====
  insert into practiceiq_service_modules (firm_id, name, code, description, icon, color, sort_order, is_system)
    values (p_firm_id, 'Form 15CA / 15CB', 'FORM_15', 'Foreign remittance certificates.', '🌍', 'purple', 100, true)
    on conflict (firm_id, code) do update set is_system = true returning id into v_module_id;
  v_filings := array['Form 15CA','Form 15CB'];
  foreach v_filing in array v_filings loop
    insert into practiceiq_service_templates (firm_id, owner_user_id, module_id, service, cadence, active, is_system)
      values (p_firm_id, p_owner_user_id, v_module_id, v_filing, 'monthly', true, true)
      on conflict do nothing;
  end loop;

  -- ===== Registrations (DSC / PAN / TAN / GST / MSME) =====
  insert into practiceiq_service_modules (firm_id, name, code, description, icon, color, sort_order, is_system)
    values (p_firm_id, 'Registrations', 'REG', 'DSC, PAN, TAN, GST and MSME registrations.', '🔑', 'grey', 110, true)
    on conflict (firm_id, code) do update set is_system = true returning id into v_module_id;
  v_filings := array['DSC Issuance/Renewal','PAN Application','TAN Application','GST Registration','MSME / Udyam'];
  foreach v_filing in array v_filings loop
    insert into practiceiq_service_templates (firm_id, owner_user_id, module_id, service, cadence, active, is_system)
      values (p_firm_id, p_owner_user_id, v_module_id, v_filing, 'annual', true, true)
      on conflict do nothing;
  end loop;

  -- ===== Trademark / IPR =====
  insert into practiceiq_service_modules (firm_id, name, code, description, icon, color, sort_order, is_system)
    values (p_firm_id, 'Trademark / IPR', 'TM_IP', 'Trademark, copyright and patent filings.', '™️', 'purple', 120, true)
    on conflict (firm_id, code) do update set is_system = true returning id into v_module_id;
  v_filings := array['TM-A (new application)','TM Renewal','Copyright','Patent Filing'];
  foreach v_filing in array v_filings loop
    insert into practiceiq_service_templates (firm_id, owner_user_id, module_id, service, cadence, active, is_system)
      values (p_firm_id, p_owner_user_id, v_module_id, v_filing, 'annual', true, true)
      on conflict do nothing;
  end loop;

  -- ===== Startup / DPIIT =====
  insert into practiceiq_service_modules (firm_id, name, code, description, icon, color, sort_order, is_system)
    values (p_firm_id, 'Startup / DPIIT', 'STARTUP', 'Startup recognition, ESOPs and reporting.', '🚀', 'teal', 130, true)
    on conflict (firm_id, code) do update set is_system = true returning id into v_module_id;
  v_filings := array['DPIIT Recognition','ESOP Filing','Section 80-IAC','Investor Reporting'];
  foreach v_filing in array v_filings loop
    insert into practiceiq_service_templates (firm_id, owner_user_id, module_id, service, cadence, active, is_system)
      values (p_firm_id, p_owner_user_id, v_module_id, v_filing, 'annual', true, true)
      on conflict do nothing;
  end loop;

  -- ===== Accounting / Bookkeeping =====
  insert into practiceiq_service_modules (firm_id, name, code, description, icon, color, sort_order, is_system)
    values (p_firm_id, 'Accounting', 'ACCOUNTS', 'Bookkeeping, ledger maintenance and financial statements.', '📚', 'blue', 140, true)
    on conflict (firm_id, code) do update set is_system = true returning id into v_module_id;
  v_filings := array['Tally Posting','Bank Reconciliation','Trial Balance Review','Financial Statements'];
  foreach v_filing in array v_filings loop
    insert into practiceiq_service_templates (firm_id, owner_user_id, module_id, service, cadence, active, is_system)
      values (p_firm_id, p_owner_user_id, v_module_id, v_filing, 'monthly', true, true)
      on conflict do nothing;
  end loop;

  -- ===== Advisory =====
  insert into practiceiq_service_modules (firm_id, name, code, description, icon, color, sort_order, is_system)
    values (p_firm_id, 'Business Advisory', 'ADVISORY', 'Tax planning, controls reviews and budgeting.', '💡', 'amber', 150, true)
    on conflict (firm_id, code) do update set is_system = true returning id into v_module_id;
  v_filings := array['Tax Planning','Compliance Calendar','Internal Controls Review','Budget & Forecast'];
  foreach v_filing in array v_filings loop
    insert into practiceiq_service_templates (firm_id, owner_user_id, module_id, service, cadence, active, is_system)
      values (p_firm_id, p_owner_user_id, v_module_id, v_filing, 'annual', true, true)
      on conflict do nothing;
  end loop;

  -- ===== Other =====
  insert into practiceiq_service_modules (firm_id, name, code, description, icon, color, sort_order, is_system)
    values (p_firm_id, 'Other', 'OTHER', 'Catch-all for legacy or uncategorised filings.', '📂', 'grey', 999, true)
    on conflict (firm_id, code) do update set is_system = true;
end;
$$;

-- Backfill: run for every existing firm. We need an owner_user_id for the
-- templates table, so pick the firm's first admin user. If none exists, skip.
do $$ declare r record; v_owner uuid;
begin
  for r in select id from practiceiq_firms loop
    select user_id into v_owner from practiceiq_firm_users
      where firm_id = r.id and role = 'admin'
      order by created_at asc limit 1;
    if v_owner is not null then
      perform seed_default_service_modules_for_firm(r.id, v_owner);
    end if;
  end loop;
end $$;
