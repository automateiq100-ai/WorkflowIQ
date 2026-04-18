'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const COMPANY_TYPES = [
  'Manufacturing', 'Trading', 'Services', 'Retail',
  'Construction', 'Financial Services', 'Hospitality', 'IT/SaaS',
];


const PROFILE_FIELDS: { key: string; label: string; description: string }[] = [
  { key: 'gst_applicable', label: 'GST Applicable',     description: 'Company is registered under GST.' },
  { key: 'gst_regular',    label: 'GST Regular Scheme', description: 'On regular GST scheme (not composition).' },
  { key: 'tds_applicable', label: 'TDS Applicable',     description: 'Company deducts TDS from payments.' },
  { key: 'has_employees',  label: 'Has Employees',      description: 'Company has salaried employees.' },
  { key: 'has_fa_filter',  label: 'Has Fixed Assets',   description: 'Company owns fixed assets.' },
  { key: 'is_goods',       label: 'Goods Business',     description: 'Deals in goods (not purely services).' },
  { key: 'full_fy',        label: 'Full Financial Year', description: 'Books cover the full April–March FY.' },
];

export default function OnboardingForm({ name, selectedTools }: { name: string | null; selectedTools: string[] }) {
  const router = useRouter();
  const [companyName, setCompanyName] = useState('');
  const [companyType, setCompanyType] = useState('');
  const [prefs, setPrefs] = useState<Record<string, boolean>>({
    gst_applicable: false, gst_regular: false, tds_applicable: false,
    has_employees: false, has_fa_filter: false, is_goods: false, full_fy: true,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function togglePref(key: string) {
    setPrefs(prev => ({ ...prev, [key]: !prev[key] }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!companyName.trim()) { setError('Company name is required.'); return; }
    if (!companyType) { setError('Please select a company type.'); return; }
    setError(null);
    setLoading(true);
    const res = await fetch('/api/onboarding/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company_name: companyName.trim(),
        company_type: companyType,
        ...prefs,
      }),
    });
    setLoading(false);
    if (res.ok) {
      router.push('/portal');
    } else {
      const data = await res.json();
      setError(data.error ?? 'Something went wrong. Please try again.');
    }
  }

  const inputStyle = {
    background: 'var(--bg4)',
    border: '1px solid var(--border)',
    color: 'var(--text1)',
  };

  return (
    <div
      className="w-full max-w-lg mx-4 rounded-xl border p-8"
      style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
    >
      {/* Header */}
      <div className="mb-6">
        <div
          className="text-2xl mb-1"
          style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}
        >
          Set up your workspace
        </div>
        <p className="text-sm" style={{ color: 'var(--text3)' }}>
          {name ? `Welcome, ${name.split(' ')[0]}. ` : ''}Tell us about your company to get started.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-6">

        {/* Section 1: Company details */}
        <div className="flex flex-col gap-3">
          <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text3)' }}>
            Company Details
          </div>
          <input
            type="text"
            placeholder="Company name"
            value={companyName}
            onChange={e => setCompanyName(e.target.value)}
            required
            className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
            style={inputStyle}
          />
          <select
            value={companyType}
            onChange={e => setCompanyType(e.target.value)}
            required
            className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
            style={{ ...inputStyle, appearance: 'auto' }}
          >
            <option value="">Select company type…</option>
            {COMPANY_TYPES.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        {/* Section 2: Accounting preferences — only for AccountingIQ users */}
        {selectedTools.includes('accountingiq') && (
          <div className="flex flex-col gap-3">
            <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text3)' }}>
              Accounting Setup
            </div>
            <p className="text-xs" style={{ color: 'var(--text3)' }}>
              Configure which checks apply to your company.
            </p>
            <div
              className="rounded-xl border overflow-hidden divide-y"
              style={{ background: 'var(--bg3)', borderColor: 'var(--border)' }}
            >
              {PROFILE_FIELDS.map(field => (
                <div
                  key={field.key}
                  className="flex items-center gap-4 px-4 py-3 cursor-pointer"
                  style={{ borderColor: 'var(--border)' }}
                  onClick={() => togglePref(field.key)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium" style={{ color: 'var(--text1)' }}>{field.label}</div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--text3)' }}>{field.description}</div>
                  </div>
                  <Toggle on={prefs[field.key]} />
                </div>
              ))}
            </div>
          </div>
        )}

        {error && <p className="text-xs" style={{ color: 'var(--red)' }}>{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 rounded-lg text-sm font-semibold transition-opacity"
          style={{ background: 'var(--teal)', color: '#000', opacity: loading ? 0.6 : 1 }}
        >
          {loading ? 'Setting up…' : 'Set up my workspace →'}
        </button>
      </form>
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
