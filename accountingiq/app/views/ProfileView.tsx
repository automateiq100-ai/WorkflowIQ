'use client';

import { useState } from 'react';
import { useApp } from '@/lib/state';
import type { CompanyProfile } from '@/lib/types';
import { PROFILE_FIELDS, COMPANY_TYPES, Toggle } from '@/app/components/CompanyForm';

export default function ProfileView() {
  const { state, dispatch } = useApp();
  const [local, setLocal] = useState<CompanyProfile>({ ...state.filters });
  const [companyName, setCompanyName] = useState(state.currentCompany?.name ?? '');
  const [companyType, setCompanyType] = useState(state.currentCompany?.companyType ?? '');
  const [saved, setSaved] = useState(false);

  function toggle(key: keyof CompanyProfile) {
    setLocal(prev => ({ ...prev, [key]: !prev[key] }));
    setSaved(false);
  }

  async function handleSave() {
    dispatch({ type: 'FILTERS_UPDATED', filters: local });

    const saves: Promise<unknown>[] = [];

    // Save company name/type/prefs to the companies table
    if (state.currentCompany) {
      saves.push(fetch(`/api/companies/${state.currentCompany.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:           companyName || state.currentCompany.name,
          company_type:   companyType || null,
          gst_applicable: local.gstApplicable,
          gst_regular:    local.gstRegular,
          tds_applicable: local.tdsApplicable,
          has_employees:  local.hasEmployees,
          has_fa_filter:  local.hasFAfilter,
          is_goods:       local.isGoods,
          full_fy:        local.fullFY,
        }),
      }));
    }

    await Promise.all(saves).catch(() => {});
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  const filtersDirty = JSON.stringify(local) !== JSON.stringify(state.filters);

  const inputStyle = {
    background: 'var(--bg4)',
    border: '1px solid var(--border)',
    color: 'var(--text1)',
  };

  return (
    <div className="p-8 max-w-2xl mx-auto animate-fade-in">
      <h1
        className="text-2xl mb-1"
        style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}
      >
        Company Profile
      </h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text3)' }}>
        Update your company details and accounting preferences.
      </p>

      {/* Company details */}
      <div className="mb-6">
        <div className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text3)' }}>
          Company Details
        </div>
        <div className="flex flex-col gap-3">
          <input
            type="text"
            placeholder="Company name"
            value={companyName}
            onChange={e => { setCompanyName(e.target.value); setSaved(false); }}
            className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
            style={inputStyle}
          />
          <select
            value={companyType}
            onChange={e => { setCompanyType(e.target.value); setSaved(false); }}
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
      <div className="mb-6">
        <div className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text3)' }}>
          Accounting Preferences
        </div>
        <div
          className="rounded-xl border overflow-hidden divide-y"
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
      </div>

      {/* Save */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          className="px-5 py-2 rounded-lg text-sm font-semibold transition-opacity"
          style={{ background: 'var(--teal)', color: '#000' }}
        >
          {saved ? 'Saved!' : 'Save Profile'}
        </button>

        {state.analysed && filtersDirty && (
          <span className="text-xs" style={{ color: 'var(--amber)' }}>
            ⚠ Saving will clear current analysis results.
          </span>
        )}
      </div>
    </div>
  );
}

