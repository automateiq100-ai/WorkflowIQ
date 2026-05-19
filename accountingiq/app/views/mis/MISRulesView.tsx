'use client';

/**
 * MIS Rules Engine — threshold editor.
 *
 * Each metric in the 73-metric catalogue can have any number of rules
 * attached.  Each rule is {operator, threshold, severity, message,
 * enabled}.  Default pack pre-loads on first visit; users can disable,
 * edit, delete or add custom rules.
 *
 * State lives in AppState.misRules.  Undefined = use DEFAULT_RULES
 * (which lets the reset button work by clearing the override).
 */

import { useState } from 'react';
import { useApp } from '@/lib/state';
import {
  DEFAULT_RULES, NO_RULE_REASON, OPERATOR_LABELS, SEVERITY_LABELS,
  type Rule, type RuleOperator, type RuleSeverity,
} from '@/lib/layer2/rules';
import { ALL_MIS_METRICS, MIS_DOMAINS, findMetric } from '@/lib/layer2/mis/metrics';
import { CHART_COLORS, SEVERITY_COLOR } from './atoms';

let _rid = 0;
const newRuleId = () => `user-${Date.now()}-${++_rid}`;

export default function MISRulesView() {
  const { state, dispatch } = useApp();
  const rules = state.misRules ?? DEFAULT_RULES;
  const [editing, setEditing] = useState<string | null>(null);

  // Group rules by metricId for display.
  const byMetric: Record<string, Rule[]> = {};
  for (const r of rules) (byMetric[r.metricId] ??= []).push(r);

  const setRule = (rule: Rule) => dispatch({ type: 'MIS_RULES_UPSERT', rule });
  const removeRule = (id: string) => dispatch({ type: 'MIS_RULES_DELETE', id });

  const toggleEnabled = (rule: Rule) => setRule({ ...rule, enabled: !rule.enabled });

  const addRule = (metricId: string) => {
    const def = findMetric(metricId);
    const rule: Rule = {
      id: newRuleId(),
      metricId,
      operator: '>',
      threshold: 0,
      severity: 'warning',
      message: `${def?.label ?? metricId} threshold breached`,
      enabled: true,
      builtIn: false,
    };
    // Materialise current rules into state if we were still on defaults.
    if (!state.misRules) dispatch({ type: 'MIS_RULES_SET', rules: [...DEFAULT_RULES, rule] });
    else setRule(rule);
    setEditing(rule.id);
  };

  const enabledCount = rules.filter(r => r.enabled).length;
  const builtInCount = rules.filter(r => r.builtIn).length;
  const customCount = rules.length - builtInCount;

  return (
    <div className="max-w-5xl mx-auto animate-fade-in space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>
            Rules Engine
          </h1>
          <p className="text-xs mt-1" style={{ color: 'var(--text3)' }}>
            Threshold-based alerts on the {ALL_MIS_METRICS.length} MIS metrics.
            Defaults loaded — disable, edit, or add your own.
          </p>
        </div>
        <button onClick={() => dispatch({ type: 'MIS_RULES_RESET' })}
          className="text-xs px-3 py-1.5 rounded-lg border"
          style={{ borderColor: 'var(--border)', color: 'var(--text3)' }}>
          ↺ Reset to defaults
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Rules enabled" value={`${enabledCount} / ${rules.length}`} color={CHART_COLORS.teal} />
        <Stat label="Built-in" value={builtInCount} color={CHART_COLORS.blue} />
        <Stat label="Custom" value={customCount} color={CHART_COLORS.purple} />
      </div>

      <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
        {MIS_DOMAINS.map(domain => (
          <div key={domain.id} className="border-b last:border-b-0" style={{ borderColor: 'var(--border)' }}>
            <div className="px-5 py-2 text-xs font-semibold uppercase tracking-wider" style={{ background: 'var(--bg3)', color: 'var(--text3)' }}>
              {domain.label}
            </div>
            {domain.metrics.map(m => {
              const metricRules = byMetric[m.id] ?? [];
              return (
                <div key={m.id} className="px-5 py-3 border-b last:border-b-0" style={{ borderColor: 'var(--bg3)' }}>
                  <div className="flex items-center gap-3 mb-1">
                    <div className="w-10 text-[10px] tabular-nums font-mono" style={{ color: 'var(--text3)' }}>{m.id}</div>
                    <div className="flex-1 text-xs font-medium" style={{ color: 'var(--text1)' }}>{m.label}</div>
                    <button onClick={() => addRule(m.id)}
                      className="text-[10px] px-2 py-1 rounded border"
                      style={{ borderColor: 'var(--border)', color: CHART_COLORS.teal }}>
                      + Add rule
                    </button>
                  </div>
                  {/* Formula + source — the metric's "logic" */}
                  {(m.formula || m.source) && (
                    <div className="ml-12 mb-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px]" style={{ color: 'var(--text3)' }}>
                      {m.formula && (
                        <span><span style={{ color: 'var(--text2)' }}>Formula:</span> <span className="font-mono" style={{ color: 'var(--text2)' }}>{m.formula}</span></span>
                      )}
                      {m.source && (
                        <span><span style={{ color: 'var(--text2)' }}>Source:</span> {m.source}</span>
                      )}
                    </div>
                  )}
                  {metricRules.length === 0 ? (
                    <div className="ml-12 text-[11px] italic" style={{ color: 'var(--text3)' }}>
                      {NO_RULE_REASON[m.id] ?? 'No default — add a custom threshold relevant to your business.'}
                    </div>
                  ) : (
                    <div className="ml-12 space-y-1.5">
                      {metricRules.map(rule => (
                        editing === rule.id
                          ? <RuleEditor key={rule.id} rule={rule}
                              onSave={(updated) => { setRule(updated); setEditing(null); }}
                              onCancel={() => setEditing(null)}
                              onDelete={rule.builtIn ? undefined : () => { removeRule(rule.id); setEditing(null); }}
                              unit={m.unit} />
                          : <RuleRow key={rule.id} rule={rule}
                              onEdit={() => setEditing(rule.id)}
                              onToggle={() => toggleEnabled(rule)}
                              unit={m.unit} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Rule row (compact display) ─────────────────────────────────────────

function RuleRow({ rule, onEdit, onToggle, unit }: {
  rule: Rule;
  onEdit: () => void;
  onToggle: () => void;
  unit?: string;
}) {
  const c = SEVERITY_COLOR[rule.severity];
  return (
    <div className="flex items-center gap-2 text-xs py-1">
      <input type="checkbox" checked={rule.enabled} onChange={onToggle}
        className="shrink-0" style={{ accentColor: CHART_COLORS.teal }} />
      <span className="font-mono text-[11px] px-2 py-0.5 rounded" style={{ background: 'var(--bg3)', color: 'var(--text2)' }}>
        {rule.operator} {formatT(rule.threshold, unit)}
        {rule.threshold2 != null && ` & ${formatT(rule.threshold2, unit)}`}
      </span>
      <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold" style={{ background: `${c}22`, color: c }}>
        {SEVERITY_LABELS[rule.severity]}
      </span>
      <span className="flex-1 truncate" style={{ color: rule.enabled ? 'var(--text2)' : 'var(--text3)', opacity: rule.enabled ? 1 : 0.6 }}>
        {rule.message}
      </span>
      {rule.builtIn && (
        <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'var(--bg3)', color: 'var(--text3)' }}>built-in</span>
      )}
      <button onClick={onEdit} className="text-[10px] px-2 py-0.5 rounded border"
        style={{ borderColor: 'var(--border)', color: 'var(--text2)' }}>Edit</button>
    </div>
  );
}

function formatT(n: number, unit?: string): string {
  if (unit === 'pct') return `${n}%`;
  if (unit === 'days') return `${n} d`;
  if (unit === 'ratio') return `${n}×`;
  return n.toLocaleString('en-IN');
}

// ── Rule editor (inline form) ──────────────────────────────────────────

function RuleEditor({ rule, onSave, onCancel, onDelete, unit }: {
  rule: Rule;
  onSave: (r: Rule) => void;
  onCancel: () => void;
  onDelete?: () => void;
  unit?: string;
}) {
  const [draft, setDraft] = useState<Rule>(rule);
  const needsT2 = draft.operator === 'between' || draft.operator === 'outside';
  return (
    <div className="rounded-lg border p-3 space-y-2" style={{ background: 'var(--bg3)', borderColor: 'var(--border)' }}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <select value={draft.operator}
          onChange={e => setDraft({ ...draft, operator: e.target.value as RuleOperator })}
          className="px-2 py-1 rounded border text-xs"
          style={{ background: 'var(--bg2)', borderColor: 'var(--border)', color: 'var(--text1)' }}>
          {(Object.keys(OPERATOR_LABELS) as RuleOperator[]).map(op => (
            <option key={op} value={op}>{op}  {OPERATOR_LABELS[op]}</option>
          ))}
        </select>
        <input type="number" value={draft.threshold}
          onChange={e => setDraft({ ...draft, threshold: Number(e.target.value) })}
          className="w-24 px-2 py-1 rounded border text-xs tabular-nums"
          style={{ background: 'var(--bg2)', borderColor: 'var(--border)', color: 'var(--text1)' }} />
        <span style={{ color: 'var(--text3)' }}>{unit ?? ''}</span>
        {needsT2 && (
          <>
            <span style={{ color: 'var(--text3)' }}>and</span>
            <input type="number" value={draft.threshold2 ?? 0}
              onChange={e => setDraft({ ...draft, threshold2: Number(e.target.value) })}
              className="w-24 px-2 py-1 rounded border text-xs tabular-nums"
              style={{ background: 'var(--bg2)', borderColor: 'var(--border)', color: 'var(--text1)' }} />
          </>
        )}
        <span style={{ color: 'var(--text3)' }}>·</span>
        <select value={draft.severity}
          onChange={e => setDraft({ ...draft, severity: e.target.value as RuleSeverity })}
          className="px-2 py-1 rounded border text-xs"
          style={{ background: 'var(--bg2)', borderColor: 'var(--border)', color: 'var(--text1)' }}>
          {(Object.keys(SEVERITY_LABELS) as RuleSeverity[]).map(s => (
            <option key={s} value={s}>{SEVERITY_LABELS[s]}</option>
          ))}
        </select>
      </div>
      <input type="text" value={draft.message}
        onChange={e => setDraft({ ...draft, message: e.target.value })}
        placeholder="Alert message"
        className="w-full px-2 py-1 rounded border text-xs"
        style={{ background: 'var(--bg2)', borderColor: 'var(--border)', color: 'var(--text1)' }} />
      <input type="text" value={draft.action ?? ''}
        onChange={e => setDraft({ ...draft, action: e.target.value || undefined })}
        placeholder="Optional action (e.g. Escalate to overdue debtors)"
        className="w-full px-2 py-1 rounded border text-xs"
        style={{ background: 'var(--bg2)', borderColor: 'var(--border)', color: 'var(--text1)' }} />
      <div className="flex items-center gap-2 justify-end">
        {onDelete && (
          <button onClick={onDelete} className="text-[10px] px-2 py-1 rounded border"
            style={{ borderColor: 'var(--border)', color: CHART_COLORS.red }}>
            ✕ Delete
          </button>
        )}
        <button onClick={onCancel} className="text-[10px] px-2 py-1 rounded border"
          style={{ borderColor: 'var(--border)', color: 'var(--text3)' }}>
          Cancel
        </button>
        <button onClick={() => onSave(draft)} className="text-[10px] px-3 py-1 rounded font-semibold"
          style={{ background: CHART_COLORS.teal, color: '#fff' }}>
          Save
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="rounded-xl border p-4" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
      <div className="text-[10px] uppercase tracking-wide font-semibold mb-1" style={{ color: 'var(--text3)' }}>{label}</div>
      <div className="text-2xl font-bold tabular-nums" style={{ color }}>{value}</div>
    </div>
  );
}
