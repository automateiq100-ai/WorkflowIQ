'use client';

/**
 * Master Setup — per-company classification config.
 *
 * Lists every Trial Balance ledger with its current category (auto-classified
 * from Tally master walk, or user-overridden), confidence badge, and an
 * inline dropdown to override.  Designed for accountants reviewing a fresh
 * client's books — bulk-confirm the high-confidence stuff in one click,
 * focus attention on low-confidence rows.
 *
 * Persists overrides per-company via lib/ledger-overrides.ts.  Once the
 * user changes a category, the next analysis run picks it up automatically
 * (engine threads `state.ledgerOverrides` into the classifier).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/lib/state';
import { analyseFiles } from '@/lib/engine';
import {
  classifyLedger,
  buildBSHierarchyMap,
  LEDGER_CATEGORY_OPTIONS,
  type LedgerCategory,
  type ClassificationConfidence,
} from '@/lib/tally-groups';
import {
  upsertOverride,
  removeOverride,
  hydrateOverridesFromServer,
  deleteOverrideOnServer,
  type LedgerOverride,
  type OverrideMap,
} from '@/lib/ledger-overrides';
import { parseMasterMap } from '@/lib/parser';
import type { TBFullRow, MasterEntry } from '@/lib/types';
import { INDUSTRY_TEMPLATES, matchTemplate } from '@/lib/industry-templates';

const CONF_BG: Record<ClassificationConfidence, string> = {
  overridden: 'rgba(45,212,191,0.15)',
  high:       'rgba(34,197,94,0.12)',
  medium:     'rgba(234,179,8,0.12)',
  low:        'rgba(234,179,8,0.18)',
  none:       'rgba(239,68,68,0.15)',
};
const CONF_COLOR: Record<ClassificationConfidence, string> = {
  overridden: 'var(--teal)',
  high:       'var(--green)',
  medium:     'var(--amber)',
  low:        'var(--amber)',
  none:       'var(--red)',
};
const CONF_LABEL: Record<ClassificationConfidence, string> = {
  overridden: 'Confirmed',
  high:       'Auto · High',
  medium:     'Auto · Medium',
  low:        'Auto · Low',
  none:       'Unclassified',
};

type FilterMode = 'all' | 'needs-review' | 'unclassified' | 'confirmed';

export default function MasterSetupView() {
  const { state, dispatch } = useApp();
  const { files, currentCompany, ledgerOverrides } = state;

  // Auto re-run analysis whenever the override map changes (Phase 3).  The
  // user just edited their master config, so every dependent number on the
  // Dashboard / Checklist / Insights views needs to recompute against the
  // new classification.  Without this, users had to manually click "Run
  // Analysis" after every override edit — a confusing two-step they
  // shouldn't have to know about.
  //
  // Implementation notes:
  //   • We debounce by 400ms so rapid back-to-back dropdown clicks coalesce
  //     into one re-run, and so the engine isn't hot-spinning on every
  //     keystroke if we ever add inline editing.
  //   • Skip on first mount — `prevSizeRef` starts uninitialised so the
  //     initial render doesn't trigger a rerun (we already have results).
  //   • Skip when no analysis has been run yet — re-running is meaningless
  //     until the user has loaded files via Upload Files.
  //   • Show a subtle "Recomputing…" pill so the user sees their change is
  //     having an effect even before they navigate to Dashboard.
  const prevOverrideCountRef = useRef<number | null>(null);
  const [isRecomputing, setIsRecomputing] = useState(false);

  // Phase 2: pull the server's latest overrides on company-select / view
  // mount so a user editing on a second device sees the server truth.
  // localStorage was already loaded by COMPANY_SELECTED — this only runs
  // a refresh in the background; if the server returns a different set
  // we dispatch to overwrite the cache.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (!currentCompany?.id) return;
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    let cancelled = false;
    (async () => {
      const fromServer = await hydrateOverridesFromServer(currentCompany.id);
      if (cancelled || !fromServer) return;
      // Skip if the cache and server already agree (avoids a bogus
      // recompute if the user's local set is in sync).
      const localSize = ledgerOverrides?.size ?? 0;
      if (fromServer.size === localSize) {
        let same = true;
        for (const [k, v] of fromServer) {
          const cur = ledgerOverrides?.get(k);
          if (!cur || cur.category !== v.category) { same = false; break; }
        }
        if (same) return;
      }
      dispatch({ type: 'LEDGER_OVERRIDES_SET', overrides: fromServer });
    })();
    return () => { cancelled = true; };
  }, [currentCompany?.id]);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const count = ledgerOverrides?.size ?? 0;
    // First render — establish baseline, do not trigger.
    if (prevOverrideCountRef.current === null) {
      prevOverrideCountRef.current = count;
      return;
    }
    // No change since last tick — nothing to do.
    if (prevOverrideCountRef.current === count) return;
    prevOverrideCountRef.current = count;

    if (!state.analysed || !state.results) return;

    setIsRecomputing(true);
    const timer = setTimeout(() => {
      try {
        const { results, parsedData, dbStats } = analyseFiles(state);
        dispatch({ type: 'ANALYSIS_DONE', results, parsedData, dbStats });
      } finally {
        setIsRecomputing(false);
      }
    }, 400);
    return () => { clearTimeout(timer); setIsRecomputing(false); };
    // We depend on the override map identity (which changes on every
    // dispatch) plus the analysed flag — re-running only when there's
    // actually something to recompute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledgerOverrides, state.analysed]);

  // Build masterMap once per render (cheap — just a Map walk).
  const masterMap = useMemo<Map<string, MasterEntry>>(() => {
    if (!files.master?.hasContent || !files.master.content) return new Map();
    return parseMasterMap(files.master.content);
  }, [files.master?.content, files.master?.hasContent]);

  // Phase 6: BS-hierarchy fallback — when the master file is missing or
  // partial, the Balance Sheet's own section structure still tells us
  // which Tally primary group each leaf belongs to.  Reused from the
  // analysis engine via state.parsedData.bsheetStatement.
  const bsHierarchy = useMemo(() => {
    return buildBSHierarchyMap(state.parsedData?.bsheetStatement);
  }, [state.parsedData?.bsheetStatement]);

  // Derive ledger list — prefer parsed tbRows from analysis (already includes
  // groups + leaves), fall back to live re-parse if analysis hasn't run yet.
  const tbRows: TBFullRow[] = (state.parsedData.tbRows as TBFullRow[]) ?? [];

  const overrides: OverrideMap = ledgerOverrides ?? new Map();
  const [filter, setFilter] = useState<FilterMode>('all');
  const [search, setSearch] = useState('');

  // Compute classification for every ledger (leaves only — groups don't need
  // categorising since they're rolled up from their children).
  const rows = useMemo(() => {
    return tbRows
      .filter(r => !r.isGroup)
      .map(r => {
        const cls = classifyLedger(r.name, masterMap, overrides, bsHierarchy);
        return { ...r, ...cls };
      });
  }, [tbRows, masterMap, overrides, bsHierarchy]);

  const counts = useMemo(() => {
    const c = { all: 0, overridden: 0, high: 0, medium: 0, low: 0, none: 0 };
    for (const r of rows) {
      c.all++;
      c[r.confidence]++;
    }
    return c;
  }, [rows]);

  const visible = useMemo(() => {
    let out = rows;
    if (filter === 'needs-review') out = out.filter(r => r.confidence === 'low' || r.confidence === 'medium');
    if (filter === 'unclassified') out = out.filter(r => r.confidence === 'none');
    if (filter === 'confirmed')    out = out.filter(r => r.confidence === 'overridden');
    if (search.trim()) {
      const q = search.toLowerCase();
      out = out.filter(r => r.name.toLowerCase().includes(q));
    }
    return out;
  }, [rows, filter, search]);

  function setCategory(ledgerName: string, category: LedgerCategory, primaryGroup?: string) {
    const next: LedgerOverride = {
      ledgerName,
      category,
      primaryGroup,
      source: 'user-edited',
      updatedAt: new Date().toISOString(),
    };
    dispatch({ type: 'LEDGER_OVERRIDES_SET', overrides: upsertOverride(overrides, next) });
  }

  function confirmAuto(ledgerName: string, category: LedgerCategory, primaryGroup?: string) {
    const next: LedgerOverride = {
      ledgerName,
      category,
      primaryGroup,
      source: 'auto-confirmed',
      updatedAt: new Date().toISOString(),
    };
    dispatch({ type: 'LEDGER_OVERRIDES_SET', overrides: upsertOverride(overrides, next) });
  }

  function revert(ledgerName: string) {
    dispatch({ type: 'LEDGER_OVERRIDES_SET', overrides: removeOverride(overrides, ledgerName) });
    // Phase 2: also delete from the server so the revert syncs across
    // devices.  Local update happens synchronously above; this is fire-
    // and-forget background work that doesn't block the UI.
    if (currentCompany?.id) void deleteOverrideOnServer(currentCompany.id, ledgerName);
  }

  /**
   * Phase 5 — apply an industry template.  For each leaf ledger that
   * isn't ALREADY overridden, find the first matching template rule and
   * create an override.  Existing overrides are never replaced (the user
   * has already confirmed those — we don't want to clobber a deliberate
   * choice with a generic preset).  Reports back the number of new rows
   * created so the user sees the impact at a glance.
   */
  function applyIndustryTemplate(templateId: string): number {
    const template = INDUSTRY_TEMPLATES.find(t => t.id === templateId);
    if (!template) return 0;
    let next = overrides;
    let added = 0;
    const now = new Date().toISOString();
    for (const r of rows) {
      const key = r.name.toLowerCase().trim();
      if (next.has(key)) continue; // never clobber a user-confirmed row
      const match = matchTemplate(template, r.name);
      if (!match) continue;
      next = upsertOverride(next, {
        ledgerName: r.name,
        category: match.category,
        primaryGroup: match.primaryGroup,
        source: 'auto-confirmed',
        updatedAt: now,
      });
      added++;
    }
    if (added > 0) {
      dispatch({ type: 'LEDGER_OVERRIDES_SET', overrides: next });
    }
    return added;
  }

  function bulkConfirmHighConfidence() {
    let next = overrides;
    for (const r of rows) {
      if (r.confidence === 'high' && !overrides.has(r.name.toLowerCase().trim())) {
        next = upsertOverride(next, {
          ledgerName: r.name,
          category: r.category,
          primaryGroup: r.primaryGroup,
          source: 'auto-confirmed',
          updatedAt: new Date().toISOString(),
        });
      }
    }
    if (next !== overrides) {
      dispatch({ type: 'LEDGER_OVERRIDES_SET', overrides: next });
    }
  }

  // ─ Empty states ─

  if (!currentCompany) {
    return (
      <div className="p-8 max-w-4xl mx-auto animate-fade-in">
        <h1 className="text-2xl mb-2" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>
          Master Setup
        </h1>
        <p className="text-sm" style={{ color: 'var(--text3)' }}>
          Select a company first.
        </p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="p-8 max-w-4xl mx-auto animate-fade-in">
        <h1 className="text-2xl mb-1" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>
          Master Setup
        </h1>
        <p className="text-sm mb-4" style={{ color: 'var(--text2)' }}>
          Per-company chart-of-accounts classification.  Confirm auto-detected
          categories, override anything our classifier got wrong, and your
          changes lock in for every future analysis run on this company.
        </p>
        <div className="rounded-xl border p-6 text-center" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
          <div className="text-sm" style={{ color: 'var(--text2)' }}>
            No Trial Balance loaded yet.
          </div>
          <div className="text-xs mt-1" style={{ color: 'var(--text3)' }}>
            Run analysis once (Upload Files → Run Analysis) to populate the ledger list.
          </div>
        </div>
      </div>
    );
  }

  // ─ Render ─

  const inputStyle: React.CSSProperties = {
    background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text1)', outline: 'none',
  };

  return (
    <div className="p-8 max-w-5xl mx-auto animate-fade-in">
      <div className="flex items-center gap-3 mb-1">
        <h1 className="text-2xl" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>
          Master Setup
        </h1>
        {isRecomputing && (
          <span
            className="text-[11px] font-semibold px-2 py-1 rounded-full"
            style={{ background: 'rgba(45,212,191,0.15)', color: 'var(--teal)' }}
            title="Re-running analysis with your updated classifications…"
          >
            ⟳ Recomputing…
          </span>
        )}
      </div>
      <p className="text-sm mb-4" style={{ color: 'var(--text2)' }}>
        Per-company chart-of-accounts classification.  Auto-detected from your
        Tally master file; you can confirm or override any row.  Overrides
        persist across re-pulls and future analysis runs — every change
        instantly recomputes Dashboard scores, Critical Flags, and reconciliations.
      </p>

      {/* Confidence summary tiles */}
      <div className="flex gap-2 flex-wrap mb-4">
        {([
          { key: 'all',          label: 'Total ledgers',    count: counts.all,        color: 'var(--text2)' },
          { key: 'confirmed',    label: 'Confirmed',        count: counts.overridden, color: 'var(--teal)' },
          { key: 'high',         label: 'Auto · High',      count: counts.high,       color: 'var(--green)' },
          { key: 'needs-review', label: 'Needs review',     count: counts.medium + counts.low, color: 'var(--amber)' },
          { key: 'unclassified', label: 'Unclassified',     count: counts.none,       color: 'var(--red)' },
        ] as const).map(t => (
          <button
            key={t.key}
            onClick={() => t.key === 'all' || t.key === 'confirmed' || t.key === 'needs-review' || t.key === 'unclassified'
              ? setFilter(t.key as FilterMode) : undefined}
            className="px-3 py-2 rounded-lg text-left transition-all"
            style={{
              background: filter === t.key ? 'var(--bg4)' : 'var(--bg3)',
              border: `1px solid ${filter === t.key ? t.color : 'var(--border)'}`,
              minWidth: 130,
            }}
          >
            <div className="text-xs" style={{ color: 'var(--text3)' }}>{t.label}</div>
            <div className="text-lg font-semibold" style={{ color: t.color }}>{t.count}</div>
          </button>
        ))}
      </div>

      {/* Controls */}
      <div className="flex gap-2 mb-3 flex-wrap items-center">
        <input
          type="text"
          placeholder="Search ledgers…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="px-3 py-1.5 rounded-lg text-sm flex-1"
          style={{ ...inputStyle, minWidth: 180 }}
        />
        <button
          onClick={bulkConfirmHighConfidence}
          className="text-xs px-3 py-1.5 rounded-lg font-semibold"
          style={{ background: 'var(--teal)', color: '#000' }}
          title="Mark every HIGH-confidence row as confirmed in one click"
        >
          ✓ Confirm all high-confidence ({counts.high} pending)
        </button>
        <select
          onChange={e => {
            const id = e.target.value;
            if (!id) return;
            const added = applyIndustryTemplate(id);
            e.target.value = '';
            if (added > 0) {
              window.alert(`Applied ${INDUSTRY_TEMPLATES.find(t => t.id === id)?.name} template — classified ${added} ledger${added === 1 ? '' : 's'}.`);
            } else {
              window.alert('No new ledgers matched this template.  All matchable ledgers already have overrides.');
            }
          }}
          defaultValue=""
          className="text-xs px-3 py-1.5 rounded-lg"
          style={inputStyle}
          title="Apply an industry preset to bulk-classify common ledgers"
        >
          <option value="">Apply industry template…</option>
          {INDUSTRY_TEMPLATES.map(t => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>

      {/* Ledger table */}
      <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--bg2)' }}>
        <div className="overflow-auto" style={{ maxHeight: 600 }}>
          <table className="w-full text-sm" style={{ borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '34%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '32%' }} />
              <col style={{ width: '20%' }} />
            </colgroup>
            <thead style={{ background: 'var(--bg3)', position: 'sticky', top: 0, zIndex: 1 }}>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th className="px-3 py-2 text-left text-xs font-semibold" style={{ color: 'var(--text3)' }}>Ledger</th>
                <th className="px-3 py-2 text-left text-xs font-semibold" style={{ color: 'var(--text3)' }}>Confidence</th>
                <th className="px-3 py-2 text-left text-xs font-semibold" style={{ color: 'var(--text3)' }}>Category</th>
                <th className="px-3 py-2 text-left text-xs font-semibold" style={{ color: 'var(--text3)' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r, i) => (
                <tr key={r.name} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'transparent' : 'var(--bg3)' }}>
                  <td className="px-3 py-2 text-sm" style={{ color: 'var(--text1)', overflow: 'hidden' }}>
                    <div className="truncate" title={r.name}>{r.name}</div>
                    {r.primaryGroup && (
                      <div className="text-[11px] truncate" style={{ color: 'var(--text3)' }}>
                        in {r.primaryGroup}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className="text-[10px] font-semibold px-2 py-0.5 rounded"
                      style={{ background: CONF_BG[r.confidence], color: CONF_COLOR[r.confidence] }}
                    >
                      {CONF_LABEL[r.confidence]}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={r.category}
                      onChange={e => setCategory(r.name, e.target.value as LedgerCategory, r.primaryGroup)}
                      className="text-xs px-2 py-1 rounded w-full"
                      style={inputStyle}
                    >
                      {Object.entries(
                        LEDGER_CATEGORY_OPTIONS.reduce<Record<string, typeof LEDGER_CATEGORY_OPTIONS>>((acc, o) => {
                          (acc[o.group] ||= []).push(o);
                          return acc;
                        }, {}),
                      ).map(([groupLabel, opts]) => (
                        <optgroup key={groupLabel} label={groupLabel}>
                          {opts.map(o => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    {r.confidence === 'overridden' ? (
                      <button
                        onClick={() => revert(r.name)}
                        className="text-xs px-2 py-1 rounded"
                        style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text3)' }}
                        title="Revert to auto-classified"
                      >
                        Revert
                      </button>
                    ) : (
                      <button
                        onClick={() => confirmAuto(r.name, r.category, r.primaryGroup)}
                        className="text-xs px-2 py-1 rounded"
                        style={{ background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text2)' }}
                        title="Lock in this classification"
                      >
                        Confirm
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-sm" style={{ color: 'var(--text3)' }}>
                    {search ? 'No ledgers match your search.' : 'No ledgers in this filter.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="text-xs mt-3" style={{ color: 'var(--text3)' }}>
        Tip: confirm or override only what you need to.  The classifier reaches
        HIGH confidence on most ledgers via the Tally master file —
        bulk-confirm those in one click, then attend to the amber/red rows.
      </div>

      {/* Forward CTA — primary path off this page once review is done.
          Disabled while overrides are still empty (the user hasn't
          confirmed anything), so we nudge them to act before moving on. */}
      <div className="mt-6 flex items-center justify-between gap-3 rounded-xl p-4"
        style={{ background: 'var(--bg2)', border: '1px solid var(--border)' }}>
        <div className="text-sm" style={{ color: 'var(--text2)' }}>
          {counts.overridden === 0
            ? 'Once you’ve confirmed your master, continue to Dashboard to see scores recomputed against your classifications.'
            : `${counts.overridden} confirmed · ready to view results.`}
        </div>
        <button
          onClick={() => dispatch({ type: 'SET_VIEW', view: 'dashboard' })}
          className="text-sm px-4 py-2 rounded-lg font-semibold whitespace-nowrap"
          style={{ background: 'var(--teal)', color: '#000' }}
        >
          Continue to Dashboard →
        </button>
      </div>
    </div>
  );
}
