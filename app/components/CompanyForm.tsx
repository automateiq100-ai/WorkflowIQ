'use client';

import type { CompanyProfile } from '@/lib/types';

export const COMPANY_TYPES = [
  'Manufacturing', 'Trading', 'Services', 'Retail',
  'Construction', 'Financial Services', 'Hospitality', 'IT/SaaS',
];

export const PROFILE_FIELDS: {
  key: keyof CompanyProfile;
  label: string;
  description: string;
}[] = [
  { key: 'gstApplicable', label: 'GST Applicable',      description: 'Company is registered under GST. Enables GST ledger checks (E1–E4).' },
  { key: 'gstRegular',    label: 'GST Regular Scheme',  description: 'Company is on regular GST scheme (not composition). Enables detailed ITC checks.' },
  { key: 'tdsApplicable', label: 'TDS Applicable',      description: 'Company deducts TDS from vendor/salary payments. Enables TDS ledger check (E5).' },
  { key: 'hasEmployees',  label: 'Has Employees',       description: 'Company has salaried employees. Enables PF/ESI compliance check (E6).' },
  { key: 'hasFAfilter',   label: 'Has Fixed Assets',    description: 'Company owns fixed assets. Enables depreciation check (E7).' },
  { key: 'isGoods',       label: 'Goods Business',      description: 'Company deals in goods (not purely services). Enables stock reconciliation checks (E8–E9).' },
  { key: 'fullFY',        label: 'Full Financial Year', description: 'Books cover the full April–March financial year. Affects month-distribution checks (F2).' },
];

export interface CompanyFormValues {
  name: string;
  companyType: string;
  prefs: CompanyProfile;
}

export const DEFAULT_PREFS: CompanyProfile = {
  gstApplicable: false,
  gstRegular: false,
  tdsApplicable: false,
  hasEmployees: false,
  hasFAfilter: false,
  isGoods: false,
  fullFY: true,
};

const inputStyle = {
  background: 'var(--bg4)',
  border: '1px solid var(--border)',
  color: 'var(--text1)',
};

export function Toggle({ on }: { on: boolean }) {
  return (
    <div
      className="w-10 h-5 rounded-full relative transition-colors shrink-0"
      style={{ background: on ? 'var(--teal)' : 'var(--bg4)' }}
    >
      <div
        className="absolute top-0.5 w-4 h-4 rounded-full transition-all"
        style={{
          background: on ? '#000' : 'var(--text3)',
          left: on ? '22px' : '2px',
        }}
      />
    </div>
  );
}

export function CompanyForm({
  values,
  onChange,
}: {
  values: CompanyFormValues;
  onChange: (next: CompanyFormValues) => void;
}) {
  function setName(name: string) { onChange({ ...values, name }); }
  function setType(companyType: string) { onChange({ ...values, companyType }); }
  function togglePref(key: keyof CompanyProfile) {
    onChange({ ...values, prefs: { ...values.prefs, [key]: !values.prefs[key] } });
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Company details */}
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text3)' }}>
          Company Details
        </div>
        <div className="flex flex-col gap-3">
          <input
            type="text"
            placeholder="Company name *"
            value={values.name}
            onChange={e => setName(e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
            style={inputStyle}
          />
          <select
            value={values.companyType}
            onChange={e => setType(e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
            style={{ ...inputStyle, appearance: 'auto' }}
          >
            <option value="">Select company type…</option>
            {COMPANY_TYPES.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Accounting preferences */}
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text3)' }}>
          Accounting Preferences
        </div>
        <div
          className="rounded-xl border overflow-hidden divide-y"
          style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
        >
          {PROFILE_FIELDS.map(field => (
            <div
              key={field.key}
              className="flex items-center gap-4 px-5 py-3 cursor-pointer"
              style={{ borderColor: 'var(--border)' }}
              onClick={() => togglePref(field.key)}
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium" style={{ color: 'var(--text1)' }}>
                  {field.label}
                </div>
                <div className="text-xs mt-0.5 leading-relaxed" style={{ color: 'var(--text3)' }}>
                  {field.description}
                </div>
              </div>
              <Toggle on={values.prefs[field.key]} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
