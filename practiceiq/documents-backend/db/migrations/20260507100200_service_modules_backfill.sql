-- Auto-assign any existing un-modulated practiceiq_service_templates rows to a
-- module by name match against an alias table. Anything that doesn't match
-- lands in OTHER. Same logic mirrored on practiceiq_client_services.
--
-- Idempotent — safe to re-run.

with aliases(alias, code) as (values
  ('gst', 'GST'),
  ('gstr', 'GST'),
  ('tds', 'TDS'),
  ('tcs', 'TDS'),
  ('itr', 'ITR'),
  ('income tax', 'ITR'),
  ('advance tax', 'ITR'),
  ('roc', 'ROC'),
  ('mca', 'ROC'),
  ('aoc-4', 'ROC'),
  ('mgt-7', 'ROC'),
  ('audit', 'AUDIT'),
  ('payroll', 'PAYROLL'),
  ('salary', 'PAYROLL'),
  ('pf', 'PF_ESI'),
  ('esi', 'PF_ESI'),
  ('professional tax', 'PT'),
  (' pt', 'PT'),
  ('fema', 'FEMA'),
  ('rbi', 'FEMA'),
  ('15ca', 'FORM_15'),
  ('15cb', 'FORM_15'),
  ('dsc', 'REG'),
  ('pan', 'REG'),
  ('tan', 'REG'),
  ('msme', 'REG'),
  ('udyam', 'REG'),
  ('trademark', 'TM_IP'),
  ('copyright', 'TM_IP'),
  ('patent', 'TM_IP'),
  ('startup', 'STARTUP'),
  ('dpiit', 'STARTUP'),
  ('esop', 'STARTUP'),
  ('accounting', 'ACCOUNTS'),
  ('bookkeeping', 'ACCOUNTS'),
  ('tally', 'ACCOUNTS'),
  ('reconciliation', 'ACCOUNTS'),
  ('advisory', 'ADVISORY'),
  ('planning', 'ADVISORY'),
  ('budget', 'ADVISORY')
)
update practiceiq_service_templates t
set module_id = m.id
from practiceiq_service_modules m, aliases a
where t.module_id is null
  and m.firm_id = t.firm_id
  and m.code = a.code
  and lower(t.service) like '%' || a.alias || '%';

-- Anything still unassigned → OTHER (per firm).
update practiceiq_service_templates t
set module_id = m.id
from practiceiq_service_modules m
where t.module_id is null
  and m.firm_id = t.firm_id
  and m.code = 'OTHER';

-- Same for client_services (mirror of templates per client).
with aliases(alias, code) as (values
  ('gst', 'GST'),('gstr', 'GST'),
  ('tds', 'TDS'),('tcs', 'TDS'),
  ('itr', 'ITR'),('income tax', 'ITR'),('advance tax', 'ITR'),
  ('roc', 'ROC'),('mca', 'ROC'),('aoc-4', 'ROC'),('mgt-7', 'ROC'),
  ('audit', 'AUDIT'),
  ('payroll', 'PAYROLL'),('salary', 'PAYROLL'),
  ('pf', 'PF_ESI'),('esi', 'PF_ESI'),
  ('professional tax', 'PT'),(' pt', 'PT'),
  ('fema', 'FEMA'),('rbi', 'FEMA'),
  ('15ca', 'FORM_15'),('15cb', 'FORM_15'),
  ('dsc', 'REG'),('pan', 'REG'),('tan', 'REG'),('msme', 'REG'),('udyam', 'REG'),
  ('trademark', 'TM_IP'),('copyright', 'TM_IP'),('patent', 'TM_IP'),
  ('startup', 'STARTUP'),('dpiit', 'STARTUP'),('esop', 'STARTUP'),
  ('accounting', 'ACCOUNTS'),('bookkeeping', 'ACCOUNTS'),('tally', 'ACCOUNTS'),('reconciliation', 'ACCOUNTS'),
  ('advisory', 'ADVISORY'),('planning', 'ADVISORY'),('budget', 'ADVISORY')
)
update practiceiq_client_services c
set module_id = m.id
from practiceiq_service_modules m, aliases a
where c.module_id is null
  and m.firm_id = c.firm_id
  and m.code = a.code
  and lower(c.service) like '%' || a.alias || '%';

update practiceiq_client_services c
set module_id = m.id
from practiceiq_service_modules m
where c.module_id is null
  and m.firm_id = c.firm_id
  and m.code = 'OTHER';
