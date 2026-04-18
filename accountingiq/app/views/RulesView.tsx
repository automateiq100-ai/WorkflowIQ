'use client';

import { useState, useEffect, useCallback } from 'react';
import { useApp } from '@/lib/state';
import type { Rule, DimKey } from '@/lib/types';
import { DIM_LABELS } from '@/lib/constants';

const STORAGE_KEY = 'aiq_rules_v1';

// Default built-in rules derived from the 59-check engine
const BUILTIN_RULES: Rule[] = [
  { id: 'A1', name: 'DayBook Mandatory', description: 'DayBook XML must be exported and readable', dimension: 'A', severity: 'critical', enabled: true, builtIn: true, checkId: 'A1', condition: 'hasDaybook === false', remediation: 'Export DayBook from Tally: Gateway → Display → Daybook → Set Date Range → Alt+E (Export) → XML' },
  { id: 'A2', name: 'Trial Balance Required', description: 'Trial Balance XML must be present and parseable', dimension: 'A', severity: 'critical', enabled: true, builtIn: true, checkId: 'A2', condition: 'hasTB === false', remediation: 'Export Trial Balance: Gateway → Display → Trial Balance → Alt+E → XML' },
  { id: 'B1', name: 'No Suspense Ledgers', description: 'No Suspense or Miscellaneous ledgers with non-zero balance', dimension: 'B', severity: 'critical', enabled: true, builtIn: true, checkId: 'B1', condition: 'suspenseCount > 0', remediation: 'Reclassify all Suspense ledger balances to the correct account groups before closing.' },
  { id: 'B2', name: 'No Duplicate Ledgers', description: 'No near-duplicate ledger names detected', dimension: 'B', severity: 'high', enabled: true, builtIn: true, checkId: 'B2', condition: 'dupPairs > 0', remediation: 'Merge or rename duplicate ledgers via Tally: Accounts Info → Ledgers → Alter.' },
  { id: 'C1', name: 'All Vouchers Numbered', description: 'Every voucher must have a voucher number', dimension: 'C', severity: 'high', enabled: true, builtIn: true, checkId: 'C1', condition: 'missingVno > 0', remediation: 'Enable auto voucher numbering in Tally: Accounts Info → Voucher Types → alter voucher type → set numbering method.' },
  { id: 'C2', name: 'No Duplicate Voucher Numbers', description: 'Each voucher number must be unique', dimension: 'C', severity: 'critical', enabled: true, builtIn: true, checkId: 'C2', condition: 'dupVouchers > 0', remediation: 'Renumber vouchers: Tally → Advanced → Renumber Vouchers.' },
  { id: 'D1', name: 'Trial Balance Balanced', description: 'Total Debits must equal Total Credits in the Trial Balance', dimension: 'D', severity: 'critical', enabled: true, builtIn: true, checkId: 'D1', condition: 'tbDiffPct >= 0.001', remediation: 'Investigate unbalanced entries in Tally and correct them. Run Trial Balance → verify balance column.' },
  { id: 'E1', name: 'Output GST Ledger Exists', description: 'Requires an Output GST ledger in the Trial Balance', dimension: 'E', severity: 'high', enabled: true, builtIn: true, checkId: 'E1', condition: 'gstApplicable && outputGSTAmt === 0', remediation: 'Create GST output ledgers (CGST Output, SGST Output, IGST Output) under Duties & Taxes in Tally.' },
  { id: 'F3', name: 'Narration Above 70%', description: 'More than 70% of vouchers should have a narration', dimension: 'F', severity: 'medium', enabled: true, builtIn: true, checkId: 'F3', condition: 'narratedPct < 0.70', remediation: 'Add narrations to all vouchers. Enforce this policy — it helps auditors trace every entry.' },
  { id: 'G3', name: 'Cash Limit Check', description: 'No cash payments above ₹10,000 (Section 269ST)', dimension: 'G', severity: 'critical', enabled: true, builtIn: true, checkId: 'G3', condition: 'cashOver10k > 0', remediation: 'Convert cash payments above ₹10,000 to cheque/bank transfers. Flag these entries for revision.' },
  { id: 'H1', name: 'DayBook–Trial Balance Reconciliation', description: 'DayBook totals must match Trial Balance totals', dimension: 'H', severity: 'critical', enabled: true, builtIn: true, checkId: 'H1', condition: 'mismatch > 1%', remediation: 'Run reconciliation in Tally and identify the source of mismatch. Common causes: partial exports or deleted vouchers.' },
];

const DIMS: DimKey[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const SEVERITIES = ['critical', 'high', 'medium', 'info'] as const;

type SeverityType = typeof SEVERITIES[number];

const SEV_COLORS: Record<string, string> = {
  critical: 'var(--red)',
  high: 'var(--coral)',
  medium: 'var(--amber)',
  info: 'var(--blue)',
};

const SEV_BG: Record<string, string> = {
  critical: 'rgba(240,72,72,0.12)',
  high:     'rgba(242,107,91,0.12)',
  medium:   'rgba(245,166,35,0.12)',
  info:     'rgba(74,158,255,0.12)',
};

function loadRules(): Rule[] {
  if (typeof window === 'undefined') return BUILTIN_RULES;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: Rule[] = JSON.parse(raw);
      // Merge: keep built-in enabled states if the user has modified them
      return BUILTIN_RULES.map(b => {
        const saved = parsed.find(r => r.id === b.id);
        return saved ? { ...b, enabled: saved.enabled } : b;
      }).concat(parsed.filter(r => !r.builtIn));
    }
  } catch {}
  return BUILTIN_RULES;
}

function saveRules(rules: Rule[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
}

const EMPTY_FORM: Omit<Rule, 'id'> = {
  name: '',
  description: '',
  dimension: 'A',
  severity: 'medium',
  enabled: true,
  builtIn: false,
  condition: '',
  remediation: '',
};

export default function RulesView() {
  const { state } = useApp();
  const { analysed, results } = state;

  const [rules, setRules] = useState<Rule[]>([]);
  const [filter, setFilter] = useState<DimKey | 'all'>('all');
  const [showModal, setShowModal] = useState(false);
  const [editRule, setEditRule] = useState<Rule | null>(null);
  const [form, setForm] = useState<Omit<Rule, 'id'>>(EMPTY_FORM);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    setRules(loadRules());
  }, []);

  const persistRules = useCallback((updated: Rule[]) => {
    setRules(updated);
    saveRules(updated);
  }, []);

  const toggleRule = (id: string) => {
    persistRules(rules.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r));
  };

  const openAdd = () => {
    setEditRule(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  };

  const openEdit = (rule: Rule) => {
    setEditRule(rule);
    setForm({ ...rule });
    setShowModal(true);
  };

  const saveRule = () => {
    if (!form.name.trim()) return;
    if (editRule) {
      persistRules(rules.map(r => r.id === editRule.id ? { ...editRule, ...form } : r));
    } else {
      const newRule: Rule = { ...form, id: `custom_${Date.now()}`, builtIn: false };
      persistRules([...rules, newRule]);
    }
    setShowModal(false);
  };

  const deleteRule = (id: string) => {
    persistRules(rules.filter(r => r.id !== id));
    setDeleteConfirm(null);
  };

  const filtered = rules.filter(r => {
    const matchDim = filter === 'all' || r.dimension === filter;
    const matchSearch = !search || r.name.toLowerCase().includes(search.toLowerCase()) || r.description.toLowerCase().includes(search.toLowerCase());
    return matchDim && matchSearch;
  });

  const enabledCount = rules.filter(r => r.enabled).length;
  const disabledCount = rules.filter(r => !r.enabled).length;
  const customCount = rules.filter(r => !r.builtIn).length;

  // Find check result for built-in rules
  const getCheckResult = (rule: Rule) => {
    if (!analysed || !results || !rule.checkId) return null;
    return results.checks.find(c => c.id === rule.checkId) ?? null;
  };

  return (
    <div className="p-6 max-w-5xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>
            Rules Engine
          </h1>
          <p className="text-xs mt-1" style={{ color: 'var(--text3)' }}>
            {enabledCount} active · {disabledCount} disabled · {customCount} custom
          </p>
        </div>
        <button
          onClick={openAdd}
          id="add-rule-btn"
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all"
          style={{ background: 'var(--teal)', color: '#000' }}
        >
          + Add Rule
        </button>
      </div>

      {/* Score impact banner */}
      {disabledCount > 0 && (
        <div
          className="mb-4 px-4 py-3 rounded-lg text-sm border flex items-center gap-2"
          style={{ background: 'rgba(245,166,35,0.08)', borderColor: 'rgba(245,166,35,0.3)', color: 'var(--amber)' }}
        >
          ⚠ {disabledCount} rule{disabledCount > 1 ? 's' : ''} disabled — this affects your accounting health score.
          Disabled rules are excluded from score calculation.
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <input
          type="text"
          placeholder="Search rules..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="px-3 py-1.5 text-sm rounded-lg border"
          style={{ background: 'var(--bg2)', borderColor: 'var(--border)', color: 'var(--text1)', width: 200 }}
        />
        <div className="flex items-center gap-1">
          {(['all', ...DIMS] as (DimKey | 'all')[]).map(d => (
            <button
              key={d}
              onClick={() => setFilter(d)}
              className="px-2.5 py-1 text-xs rounded-md font-medium transition-colors"
              style={{
                background: filter === d ? 'var(--bg4)' : 'transparent',
                color: filter === d ? 'var(--teal)' : 'var(--text3)',
                border: `1px solid ${filter === d ? 'var(--teal)' : 'var(--border)'}`,
              }}
            >
              {d === 'all' ? 'All' : d}
            </button>
          ))}
        </div>
      </div>

      {/* Rules list */}
      <div className="space-y-2">
        {filtered.map(rule => {
          const checkResult = getCheckResult(rule);
          const statusColor =
            checkResult?.status === 'pass'    ? 'var(--green)'  :
            checkResult?.status === 'fail'    ? 'var(--red)'    :
            checkResult?.status === 'partial' ? 'var(--amber)'  :
            checkResult?.status === 'missing' ? 'var(--text3)'  :
            'var(--text3)';

          return (
            <div
              key={rule.id}
              className="rounded-xl border px-4 py-3 flex items-start gap-4"
              style={{
                background: 'var(--bg2)',
                borderColor: rule.enabled ? 'var(--border)' : 'var(--bg4)',
                opacity: rule.enabled ? 1 : 0.55,
              }}
            >
              {/* Toggle */}
              <button
                onClick={() => toggleRule(rule.id)}
                title={rule.enabled ? 'Disable rule' : 'Enable rule'}
                className="mt-0.5 w-8 h-4 rounded-full shrink-0 transition-all"
                style={{
                  background: rule.enabled ? 'var(--teal)' : 'var(--bg4)',
                  border: `2px solid ${rule.enabled ? 'var(--teal)' : 'var(--border)'}`,
                  position: 'relative',
                }}
              >
                <span
                  className="absolute top-0 w-3 h-3 rounded-full transition-all"
                  style={{
                    background: '#fff',
                    left: rule.enabled ? 'calc(100% - 14px)' : '2px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                  }}
                />
              </button>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium" style={{ color: 'var(--text1)' }}>{rule.name}</span>
                  <span
                    className="text-xs px-1.5 py-0.5 rounded font-semibold"
                    style={{ background: SEV_BG[rule.severity], color: SEV_COLORS[rule.severity] }}
                  >
                    {rule.severity.toUpperCase()}
                  </span>
                  <span
                    className="text-xs px-1.5 py-0.5 rounded font-mono"
                    style={{ background: 'var(--bg4)', color: 'var(--text2)' }}
                  >
                    {rule.dimension} · {DIM_LABELS[rule.dimension]}
                  </span>
                  {rule.builtIn && (
                    <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--bg4)', color: 'var(--text3)' }}>
                      Built-in
                    </span>
                  )}
                  {/* Live check status */}
                  {checkResult && (
                    <span className="text-xs font-medium" style={{ color: statusColor }}>
                      ● {checkResult.status.toUpperCase()}
                      {checkResult.status !== 'na' && ` (${checkResult.pts}/${checkResult.max} pts)`}
                    </span>
                  )}
                </div>
                <p className="text-xs mt-1" style={{ color: 'var(--text2)' }}>{rule.description}</p>
                {rule.condition && (
                  <p className="text-xs mt-0.5 font-mono" style={{ color: 'var(--text3)' }}>
                    Condition: {rule.condition}
                  </p>
                )}
                {/* Remediation — always shown */}
                <div
                  className="mt-2 text-xs px-3 py-2 rounded-lg border"
                  style={{ background: 'var(--bg3)', borderColor: 'var(--border)', color: 'var(--text2)' }}
                >
                  <span style={{ color: 'var(--teal)', fontWeight: 600 }}>How to fix: </span>
                  {rule.remediation}
                </div>
                {/* Check note from latest analysis */}
                {checkResult?.note && (
                  <p className="text-xs mt-1.5 italic" style={{ color: 'var(--text3)' }}>
                    Last analysis: {checkResult.note}
                  </p>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-1.5 shrink-0">
                <button
                  onClick={() => openEdit(rule)}
                  className="text-xs px-2.5 py-1 rounded border transition-colors"
                  style={{ borderColor: 'var(--border)', color: 'var(--text2)' }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--teal)')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
                >
                  Edit
                </button>
                {!rule.builtIn && (
                  <button
                    onClick={() => setDeleteConfirm(rule.id)}
                    className="text-xs px-2.5 py-1 rounded border transition-colors"
                    style={{ borderColor: 'var(--border)', color: 'var(--red)' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(240,72,72,0.1)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="text-center py-12" style={{ color: 'var(--text3)' }}>
            No rules match your search.
          </div>
        )}
      </div>

      {/* ── Add/Edit Modal ── */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={() => setShowModal(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border p-6"
            style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
            onClick={e => e.stopPropagation()}
          >
            <h2 className="text-lg mb-4" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>
              {editRule ? 'Edit Rule' : 'Add Custom Rule'}
            </h2>

            <div className="space-y-3">
              <Field label="Rule Name">
                <input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. GST Reconciliation"
                  className="w-full px-3 py-2 text-sm rounded-lg border"
                  style={{ background: 'var(--bg3)', borderColor: 'var(--border)', color: 'var(--text1)' }}
                />
              </Field>

              <Field label="Description">
                <textarea
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  rows={2}
                  placeholder="What does this rule check?"
                  className="w-full px-3 py-2 text-sm rounded-lg border resize-none"
                  style={{ background: 'var(--bg3)', borderColor: 'var(--border)', color: 'var(--text1)' }}
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Dimension">
                  <select
                    value={form.dimension}
                    onChange={e => setForm(f => ({ ...f, dimension: e.target.value as DimKey }))}
                    className="w-full px-3 py-2 text-sm rounded-lg border"
                    style={{ background: 'var(--bg3)', borderColor: 'var(--border)', color: 'var(--text1)' }}
                  >
                    {DIMS.map(d => (
                      <option key={d} value={d}>{d} — {DIM_LABELS[d]}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Severity">
                  <select
                    value={form.severity}
                    onChange={e => setForm(f => ({ ...f, severity: e.target.value as SeverityType }))}
                    className="w-full px-3 py-2 text-sm rounded-lg border"
                    style={{ background: 'var(--bg3)', borderColor: 'var(--border)', color: 'var(--text1)' }}
                  >
                    {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
              </div>

              <Field label="Condition (human-readable)">
                <input
                  value={form.condition ?? ''}
                  onChange={e => setForm(f => ({ ...f, condition: e.target.value }))}
                  placeholder="e.g. suspenseCount > 0"
                  className="w-full px-3 py-2 text-sm rounded-lg border font-mono"
                  style={{ background: 'var(--bg3)', borderColor: 'var(--border)', color: 'var(--text1)' }}
                />
              </Field>

              <Field label="Remediation / How to Fix">
                <textarea
                  value={form.remediation}
                  onChange={e => setForm(f => ({ ...f, remediation: e.target.value }))}
                  rows={3}
                  placeholder="Step-by-step instructions for the accountant to fix this issue..."
                  className="w-full px-3 py-2 text-sm rounded-lg border resize-none"
                  style={{ background: 'var(--bg3)', borderColor: 'var(--border)', color: 'var(--text1)' }}
                />
              </Field>
            </div>

            <div className="flex gap-2 mt-5 justify-end">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-sm rounded-lg border"
                style={{ borderColor: 'var(--border)', color: 'var(--text2)' }}
              >
                Cancel
              </button>
              <button
                onClick={saveRule}
                disabled={!form.name.trim()}
                className="px-4 py-2 text-sm rounded-lg font-medium"
                style={{ background: 'var(--teal)', color: '#000', opacity: form.name.trim() ? 1 : 0.5 }}
              >
                {editRule ? 'Save Changes' : 'Add Rule'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirm Modal ── */}
      {deleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={() => setDeleteConfirm(null)}
        >
          <div
            className="w-80 rounded-2xl border p-6 text-center"
            style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="text-2xl mb-3">🗑</div>
            <h3 className="text-base font-semibold mb-1" style={{ color: 'var(--text1)' }}>Delete Rule?</h3>
            <p className="text-xs mb-5" style={{ color: 'var(--text3)' }}>This action cannot be undone.</p>
            <div className="flex gap-2">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 py-2 text-sm rounded-lg border"
                style={{ borderColor: 'var(--border)', color: 'var(--text2)' }}
              >
                Cancel
              </button>
              <button
                onClick={() => deleteRule(deleteConfirm)}
                className="flex-1 py-2 text-sm rounded-lg font-medium"
                style={{ background: 'var(--red)', color: '#fff' }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text3)' }}>
        {label}
      </label>
      {children}
    </div>
  );
}
