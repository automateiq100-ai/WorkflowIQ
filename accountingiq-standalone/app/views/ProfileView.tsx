'use client';

import { useMemo, useState } from 'react';
import { useApp } from '@/lib/state';
import type { CompanyProfile, MasterEntry } from '@/lib/types';
import { PROFILE_FIELDS, COMPANY_TYPES, Toggle } from '@/app/components/CompanyForm';
import { detectProfileFlags, suggestionsDiffer, type FlagConfidence } from '@/lib/profile-detector';

const CONF_PALETTE: Record<FlagConfidence, { bg: string; fg: string; label: string }> = {
  high:   { bg: 'rgba(34,197,94,0.12)', fg: 'var(--green)', label: 'Auto · High' },
  medium: { bg: 'rgba(234,179,8,0.12)', fg: 'var(--amber)', label: 'Auto · Medium' },
  low:    { bg: 'rgba(234,179,8,0.18)', fg: 'var(--amber)', label: 'Auto · Low' },
  none:   { bg: 'rgba(239,68,68,0.15)', fg: 'var(--red)',   label: 'Unknown' },
};

export default function ProfileView() {
  const { state, dispatch } = useApp();
  const [local, setLocal] = useState<CompanyProfile>({ ...state.filters });
  const [companyName, setCompanyName] = useState(state.currentCompany?.name ?? '');
  const [companyType, setCompanyType] = useState(state.currentCompany?.companyType ?? '');
  const [saved, setSaved] = useState(false);

  // Phase 8: auto-detect every profile flag from already-parsed data so
  // users get a confident baseline rather than having to set 7 toggles
  // manually before analysis.  Recomputes whenever underlying data
  // changes (overrides edited, re-pull, etc.) — same model as the
  // ledger-classification master.
  const suggestions = useMemo(() => detectProfileFlags({
    parsedData: state.parsedData,
    dbStats: state.files.daybook.chunkedStats ?? null,
    masterEntries: (state.parsedData.masterEntries as MasterEntry[] | undefined) ?? [],
    ledgerOverrides: state.ledgerOverrides,
    requestedPeriod: state.requestedPeriod,
  }), [state.parsedData, state.files.daybook.chunkedStats, state.ledgerOverrides, state.requestedPeriod]);

  const hasSuggestions = state.analysed && suggestionsDiffer(suggestions, local);

  function applyAllSuggestions() {
    setLocal(prev => {
      const next: CompanyProfile = { ...prev };
      for (const k of Object.keys(suggestions) as Array<keyof CompanyProfile>) {
        next[k] = suggestions[k].value;
      }
      return next;
    });
    setSaved(false);
  }

  function applySingleSuggestion(key: keyof CompanyProfile) {
    setLocal(prev => ({ ...prev, [key]: suggestions[key].value }));
    setSaved(false);
  }

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

      {/* Accounting preferences with auto-detected suggestions */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text3)' }}>
            Accounting Preferences
          </div>
          {hasSuggestions && (
            <button
              onClick={applyAllSuggestions}
              className="text-xs px-3 py-1.5 rounded-lg font-semibold"
              style={{ background: 'var(--teal)', color: '#000' }}
              title="Adopt every auto-detected value in one click"
            >
              ✓ Apply all suggestions
            </button>
          )}
        </div>
        <div
          className="rounded-xl border overflow-hidden divide-y"
          style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
        >
          {PROFILE_FIELDS.map(field => {
            const sug = state.analysed ? suggestions[field.key] : null;
            const matchesSuggestion = sug ? local[field.key] === sug.value : true;
            const palette = sug ? CONF_PALETTE[sug.confidence] : null;
            return (
              <div
                key={field.key}
                className="flex items-start gap-4 px-5 py-4 cursor-pointer"
                style={{ borderColor: 'var(--border)' }}
                onClick={() => toggle(field.key)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="text-sm font-medium" style={{ color: 'var(--text1)' }}>
                      {field.label}
                    </div>
                    {sug && palette && (
                      <span
                        className="text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0"
                        style={{ background: palette.bg, color: palette.fg }}
                        title={sug.reason}
                      >
                        {palette.label}: {sug.value ? 'Yes' : 'No'}
                      </span>
                    )}
                  </div>
                  <div className="text-xs mt-0.5 leading-relaxed" style={{ color: 'var(--text3)' }}>
                    {field.description}
                  </div>
                  {sug && (
                    <div className="text-xs mt-1" style={{ color: 'var(--text3)' }}>
                      {sug.reason}
                    </div>
                  )}
                  {sug && !matchesSuggestion && (
                    <button
                      onClick={(e) => { e.stopPropagation(); applySingleSuggestion(field.key); }}
                      className="text-xs mt-1.5 underline"
                      style={{ color: 'var(--teal)' }}
                    >
                      Apply suggestion ({sug.value ? 'Yes' : 'No'})
                    </button>
                  )}
                </div>
                <Toggle on={local[field.key]} />
              </div>
            );
          })}
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

