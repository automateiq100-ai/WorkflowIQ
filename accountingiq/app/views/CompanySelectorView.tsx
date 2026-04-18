'use client';

import { useState, useEffect } from 'react';
import { useApp } from '@/lib/state';
import { companyToFilters } from '@/lib/types';
import type { Company } from '@/lib/types';
import { CompanyForm, DEFAULT_PREFS } from '@/app/components/CompanyForm';
import type { CompanyFormValues } from '@/app/components/CompanyForm';

const PREF_TAGS: { key: keyof typeof DEFAULT_PREFS; label: string }[] = [
  { key: 'gstApplicable', label: 'GST' },
  { key: 'gstRegular',    label: 'GST Regular' },
  { key: 'tdsApplicable', label: 'TDS' },
  { key: 'hasEmployees',  label: 'Employees' },
  { key: 'hasFAfilter',   label: 'Fixed Assets' },
  { key: 'isGoods',       label: 'Goods' },
];

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('');
}

export default function CompanySelectorView() {
  const { dispatch } = useApp();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'list' | 'add' | 'edit'>('list');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<CompanyFormValues>({
    name: '', companyType: '', prefs: { ...DEFAULT_PREFS },
  });
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadCompanies() {
    setLoading(true);
    try {
      const res = await fetch('/api/companies');
      if (res.ok) {
        const data = await res.json();
        setCompanies(data.companies ?? []);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadCompanies(); }, []);

  function openAdd() {
    setFormValues({ name: '', companyType: '', prefs: { ...DEFAULT_PREFS } });
    setEditingId(null);
    setError(null);
    setMode('add');
  }

  function openEdit(company: Company) {
    setFormValues({
      name: company.name,
      companyType: company.company_type ?? '',
      prefs: companyToFilters(company),
    });
    setEditingId(company.id);
    setError(null);
    setMode('edit');
  }

  function selectCompany(company: Company) {
    dispatch({
      type: 'COMPANY_SELECTED',
      company: { id: company.id, name: company.name, companyType: company.company_type },
      filters: companyToFilters(company),
    });
  }

  async function handleSave() {
    if (!formValues.name.trim()) { setError('Company name is required'); return; }
    setSaving(true);
    setError(null);
    try {
      const body = {
        name:           formValues.name.trim(),
        company_type:   formValues.companyType || null,
        gst_applicable: formValues.prefs.gstApplicable,
        gst_regular:    formValues.prefs.gstRegular,
        tds_applicable: formValues.prefs.tdsApplicable,
        has_employees:  formValues.prefs.hasEmployees,
        has_fa_filter:  formValues.prefs.hasFAfilter,
        is_goods:       formValues.prefs.isGoods,
        full_fy:        formValues.prefs.fullFY,
      };

      const url    = mode === 'edit' ? `/api/companies/${editingId}` : '/api/companies';
      const method = mode === 'edit' ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? 'Failed to save');
        return;
      }

      await loadCompanies();
      setMode('list');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    await fetch(`/api/companies/${id}`, { method: 'DELETE' });
    setDeleteConfirm(null);
    await loadCompanies();
  }

  // ── Form view ──────────────────────────────────────────────────────────────
  if (mode === 'add' || mode === 'edit') {
    return (
      <div className="p-8 max-w-2xl mx-auto animate-fade-in">
        <button
          onClick={() => setMode('list')}
          className="text-sm mb-5 flex items-center gap-1.5"
          style={{ color: 'var(--text3)' }}
        >
          ← Back
        </button>
        <h1
          className="text-2xl mb-1"
          style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}
        >
          {mode === 'add' ? 'Add Company' : 'Edit Company'}
        </h1>
        <p className="text-sm mb-6" style={{ color: 'var(--text3)' }}>
          {mode === 'add' ? 'Set up a new client company.' : 'Update company details and preferences.'}
        </p>

        <CompanyForm values={formValues} onChange={setFormValues} />

        {error && (
          <p className="text-xs mt-3" style={{ color: 'var(--red)' }}>{error}</p>
        )}

        <div className="mt-6">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2.5 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-40"
            style={{ background: 'var(--teal)', color: '#000' }}
          >
            {saving ? 'Saving…' : mode === 'add' ? 'Add Company' : 'Save Changes'}
          </button>
        </div>
      </div>
    );
  }

  // ── List view ──────────────────────────────────────────────────────────────
  return (
    <div className="p-8 max-w-2xl mx-auto animate-fade-in">
      <div className="flex items-center justify-between mb-1">
        <h1
          className="text-2xl"
          style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}
        >
          Companies
        </h1>
        <button
          onClick={openAdd}
          className="text-sm px-4 py-2 rounded-lg font-semibold transition-opacity"
          style={{ background: 'var(--teal)', color: '#000' }}
        >
          + Add Company
        </button>
      </div>
      <p className="text-sm mb-6" style={{ color: 'var(--text3)' }}>
        Select a company to begin analysis, or add a new one.
      </p>

      {loading ? (
        <div className="text-sm" style={{ color: 'var(--text3)' }}>Loading…</div>
      ) : companies.length === 0 ? (
        <div
          className="rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-3 py-14 px-6"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="text-3xl" style={{ color: 'var(--text3)' }}>⊙</div>
          <div className="text-sm font-medium" style={{ color: 'var(--text1)' }}>No companies yet</div>
          <div className="text-xs" style={{ color: 'var(--text3)' }}>Add your first client company to get started.</div>
          <button
            onClick={openAdd}
            className="mt-2 text-sm px-4 py-2 rounded-lg font-semibold"
            style={{ background: 'var(--teal)', color: '#000' }}
          >
            + Add Company
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {companies.map(company => {
            const filters = companyToFilters(company);
            const tags = PREF_TAGS.filter(t => filters[t.key as keyof typeof filters]);
            const isDeleting = deleteConfirm === company.id;
            return (
              <div
                key={company.id}
                className="rounded-xl border overflow-hidden"
                style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
              >
                <div
                  className="flex items-center gap-4 px-5 py-4 cursor-pointer transition-colors"
                  style={{}}
                  onClick={() => !isDeleting && selectCompany(company)}
                  onMouseEnter={e => { if (!isDeleting) (e.currentTarget as HTMLElement).style.background = 'var(--bg3)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = ''; }}
                >
                  {/* Initials avatar */}
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                    style={{ background: 'var(--bg4)', color: 'var(--teal)' }}
                  >
                    {initials(company.name)}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold" style={{ color: 'var(--text1)' }}>
                      {company.name}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                      {company.company_type && (
                        <span
                          className="text-xs px-2 py-0.5 rounded-full"
                          style={{ background: 'var(--bg4)', color: 'var(--text2)' }}
                        >
                          {company.company_type}
                        </span>
                      )}
                      {tags.map(t => (
                        <span
                          key={t.key}
                          className="text-xs px-2 py-0.5 rounded-full"
                          style={{ background: 'rgba(82,196,169,0.1)', color: 'var(--teal)' }}
                        >
                          {t.label}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Actions */}
                  <div
                    className="flex items-center gap-2 shrink-0"
                    onClick={e => e.stopPropagation()}
                  >
                    {isDeleting ? (
                      <>
                        <span className="text-xs" style={{ color: 'var(--text3)' }}>Delete?</span>
                        <button
                          onClick={() => handleDelete(company.id)}
                          className="text-xs px-2 py-1 rounded"
                          style={{ background: 'rgba(240,72,72,0.12)', color: 'var(--red)' }}
                        >
                          Yes
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(null)}
                          className="text-xs px-2 py-1 rounded"
                          style={{ background: 'var(--bg4)', color: 'var(--text2)' }}
                        >
                          No
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => openEdit(company)}
                          className="w-7 h-7 rounded flex items-center justify-center text-xs transition-colors"
                          style={{ color: 'var(--text3)' }}
                          onMouseEnter={e => (e.currentTarget.style.color = 'var(--text1)')}
                          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text3)')}
                          title="Edit"
                        >
                          ✎
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(company.id)}
                          className="w-7 h-7 rounded flex items-center justify-center text-xs transition-colors"
                          style={{ color: 'var(--text3)' }}
                          onMouseEnter={e => (e.currentTarget.style.color = 'var(--red)')}
                          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text3)')}
                          title="Delete"
                        >
                          ✕
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
