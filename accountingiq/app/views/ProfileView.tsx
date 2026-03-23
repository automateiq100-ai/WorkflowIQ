'use client';

import { useState } from 'react';
import { useApp } from '@/lib/state';
import type { CompanyProfile } from '@/lib/types';

const PROFILE_FIELDS: {
  key: keyof CompanyProfile;
  label: string;
  description: string;
}[] = [
  {
    key: 'gstApplicable',
    label: 'GST Applicable',
    description: 'Company is registered under GST. Enables GST ledger checks (E1–E4).',
  },
  {
    key: 'gstRegular',
    label: 'GST Regular Scheme',
    description: 'Company is on regular GST scheme (not composition). Enables detailed ITC checks.',
  },
  {
    key: 'tdsApplicable',
    label: 'TDS Applicable',
    description: 'Company deducts TDS from vendor/salary payments. Enables TDS ledger check (E5).',
  },
  {
    key: 'hasEmployees',
    label: 'Has Employees',
    description: 'Company has salaried employees. Enables PF/ESI compliance check (E6).',
  },
  {
    key: 'hasFAfilter',
    label: 'Has Fixed Assets',
    description: 'Company owns fixed assets. Enables depreciation check (E7).',
  },
  {
    key: 'isGoods',
    label: 'Goods Business',
    description: 'Company deals in goods (not purely services). Enables stock reconciliation checks (E8–E9).',
  },
  {
    key: 'fullFY',
    label: 'Full Financial Year',
    description: 'Books cover the full April–March financial year. Affects month-distribution checks (F2).',
  },
];

export default function ProfileView() {
  const { state, dispatch } = useApp();
  const [local, setLocal] = useState<CompanyProfile>({ ...state.filters });
  const [saved, setSaved] = useState(false);

  function toggle(key: keyof CompanyProfile) {
    setLocal(prev => ({ ...prev, [key]: !prev[key] }));
    setSaved(false);
  }

  function handleSave() {
    dispatch({ type: 'FILTERS_UPDATED', filters: local });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  const dirty = JSON.stringify(local) !== JSON.stringify(state.filters);

  return (
    <div className="p-8 max-w-2xl mx-auto animate-fade-in">
      <h1
        className="text-2xl mb-1"
        style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}
      >
        Company Profile
      </h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text3)' }}>
        Configure which checks apply to your company. Saving will reset analysis results.
      </p>

      <div
        className="rounded-xl border overflow-hidden divide-y mb-6"
        style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
      >
        {PROFILE_FIELDS.map(field => (
          <div
            key={field.key}
            className="flex items-center gap-4 px-5 py-4 cursor-pointer"
            style={{ borderColor: 'var(--border)' }}
            onClick={() => toggle(field.key)}
          >
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium" style={{ color: 'var(--text1)' }}>
                {field.label}
              </div>
              <div className="text-xs mt-0.5 leading-relaxed" style={{ color: 'var(--text3)' }}>
                {field.description}
              </div>
            </div>
            <Toggle on={local[field.key]} />
          </div>
        ))}
      </div>

      {/* Save */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={!dirty}
          className="px-5 py-2 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-40"
          style={{ background: 'var(--teal)', color: '#000' }}
        >
          {saved ? 'Saved!' : 'Save Profile'}
        </button>

        {state.analysed && dirty && (
          <span className="text-xs" style={{ color: 'var(--amber)' }}>
            ⚠ Saving will clear current analysis results.
          </span>
        )}
      </div>
    </div>
  );
}

function Toggle({ on }: { on: boolean }) {
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
