'use client';

/**
 * Shared layout for every MIS Report panel.
 *
 * Renders the gradient toolbar (score, period, unit toggle, Excel button)
 * and an empty-state fallback for when no analysis has been run yet.
 * Each panel passes its content as children.
 *
 * Centralising this here lets every panel file stay focused on its viz —
 * Cover / P&L / Cash Flow / etc. don't need to know about the toolbar,
 * the readiness score header, the Excel-download wiring, or how to detect
 * "not yet analysed" state.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { useApp } from '@/lib/state';
import { runMIS, type MISRunOutput } from '@/lib/layer2/mis/runner';
import { forecastMIS, type MISForecast } from '@/lib/layer2/mis/forecast';
import { downloadMISExcel } from '@/lib/layer2/mis/excel';
import { prefetchAllSectionInsights } from '@/lib/layer2/mis/ai-insights';
import {
  runRules, violationsByMetric, DEFAULT_RULES, type RuleViolation,
} from '@/lib/layer2/rules';
import { CHART_COLORS, type ReportUnit } from './atoms';

// ── Local-storage unit preference ──────────────────────────────────────

const UNIT_KEY = 'aiq_mis_unit';

function loadUnit(): ReportUnit {
  if (typeof window === 'undefined') return 'lakhs';
  const v = window.sessionStorage.getItem(UNIT_KEY);
  return v === 'absolute' || v === 'crores' ? v : 'lakhs';
}

function persistUnit(u: ReportUnit) {
  if (typeof window !== 'undefined') window.sessionStorage.setItem(UNIT_KEY, u);
}

// ── Hook: shared MIS computation ──────────────────────────────────────

export function useMIS(): {
  out: MISRunOutput;
  forecast: MISForecast;
  unit: ReportUnit;
  setUnit: (u: ReportUnit) => void;
  exporting: boolean;
  triggerExcel: () => Promise<void>;
  company: string;
  period: string;
  sector: string | null;
  analysed: boolean;
  violations: RuleViolation[];
  violationsByMetricId: Record<string, RuleViolation[]>;
  traceToBackup: (metricId: string) => void;
  navigateTo: (view: import('@/lib/types').ViewId) => void;
  navigateToModule: (module: import('@/lib/types').ModuleId) => void;
} {
  const { state, dispatch } = useApp();
  const [unit, setUnitState] = useState<ReportUnit>(() => loadUnit());
  const [exporting, setExporting] = useState(false);

  const out = useMemo(
    () => runMIS({
      state,
      manual: state.misManualInputs ?? {},
      budget: state.misBudget,
    }),
    [state],
  );
  const forecast = useMemo(() => forecastMIS(out.context), [out.context]);
  const period = state.results ? (out.periods[0]?.label ?? 'Current period') : 'No data';
  const company = state.currentCompany?.name ?? 'Company';
  const sector = state.misSetup.sector;

  const violations = useMemo(
    () => runRules(state.misRules ?? DEFAULT_RULES, out.byId, sector),
    [state.misRules, out.byId, sector],
  );
  const violationsByMetricId = useMemo(() => violationsByMetric(violations), [violations]);

  const setUnit = (u: ReportUnit) => {
    setUnitState(u);
    persistUnit(u);
  };

  const triggerExcel = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      // Pre-fetch AI observations + fix plan for every section the workbook
      // includes (cache hits return instantly).  Embeds the richer AI
      // commentary into each Excel tab instead of the deterministic rule-
      // derived fallback.  Skipped silently when consent isn't given.
      const sections = [
        'Executive Summary', 'P&L', 'Cash Flow', 'Balance Sheet',
        'Working Capital', 'Cost Analysis', 'Business Performance',
        'Statutory', 'Forecast',
      ];
      const aiInsightsBySection = await prefetchAllSectionInsights(state, sections);

      await downloadMISExcel(out, {
        company, period, sector, unit, forecast, violations, aiInsightsBySection,
      });
    } finally {
      setExporting(false);
    }
  };

  const traceToBackup = (metricId: string) => {
    dispatch({ type: 'MIS_BACKUP_FOCUS', metricId });
    dispatch({ type: 'SET_VIEW', view: 'mis-report-backup' });
  };

  const navigateTo = (view: import('@/lib/types').ViewId) => {
    dispatch({ type: 'SET_VIEW', view });
  };

  const navigateToModule = (module: import('@/lib/types').ModuleId) => {
    dispatch({ type: 'SET_MODULE', module });
  };

  return {
    out, forecast, unit, setUnit, exporting, triggerExcel,
    company, period, sector, analysed: state.analysed,
    violations, violationsByMetricId,
    traceToBackup, navigateTo, navigateToModule,
  };
}

// ── Layout shell ──────────────────────────────────────────────────────

export interface ReportLayoutProps {
  /** When true, render only the toolbar — children must provide their own
   *  empty-state.  When false (default), an analysis-pending message is
   *  shown if state isn't analysed yet. */
  ignoreAnalysisGate?: boolean;
  /** When true, hide the Excel button (e.g. on Setup pages). */
  hideExcel?: boolean;
  /** Optional right-side action node added next to the unit toggle. */
  action?: ReactNode;
  children: ReactNode;
}

export default function ReportLayout(props: ReportLayoutProps) {
  const m = useMIS();

  if (!m.analysed && !props.ignoreAnalysisGate) {
    return (
      <div className="max-w-7xl mx-auto p-8">
        <ReportToolbar mis={m} hideExcel={true} />
        <div className="mt-12 text-center">
          <div className="text-base font-medium mb-2" style={{ color: 'var(--text1)' }}>
            MIS Report awaits analysis
          </div>
          <div className="text-xs" style={{ color: 'var(--text3)' }}>
            Go to <strong>Account Health → Upload Files → Run Analysis</strong> first.
            Every panel below is computed from your uploaded XMLs — no mock data.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto animate-fade-in">
      <ReportToolbar mis={m} hideExcel={props.hideExcel} action={props.action} />
      <div className="mt-5">{props.children}</div>
    </div>
  );
}

// ── Toolbar ────────────────────────────────────────────────────────────

function ReportToolbar({ mis, hideExcel, action }: {
  mis: ReturnType<typeof useMIS>;
  hideExcel?: boolean;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-2xl p-5" style={{
      background: 'linear-gradient(135deg, rgba(15,212,160,0.10), rgba(74,158,255,0.06))',
      border: '1px solid var(--border)',
    }}>
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>{mis.company}</h1>
          <div className="text-xs mt-1" style={{ color: 'var(--text2)' }}>
            MIS Report · {mis.period} · {mis.sector ?? 'No sector selected'}
          </div>
        </div>
        <div className="flex items-center gap-6 flex-wrap">
          <div className="text-center">
            <div className="text-3xl font-bold" style={{ color: CHART_COLORS.teal }}>{mis.out.readiness.misScore}</div>
            <div className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text3)' }}>MIS Score</div>
          </div>
          <div className="text-center">
            <div className="text-xl font-semibold" style={{ color: 'var(--text2)' }}>{mis.out.readiness.l1Score}</div>
            <div className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text3)' }}>Books (L1)</div>
          </div>
          <div className="text-center">
            <div className="text-xl font-semibold" style={{ color: 'var(--text2)' }}>{Math.round(mis.out.readiness.readinessPct * 100)}%</div>
            <div className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text3)' }}>Readiness</div>
          </div>
          <div className="h-10 w-px" style={{ background: 'var(--border)' }} />
          <div className="flex border rounded-lg overflow-hidden" style={{ borderColor: 'var(--border)' }}>
            {(['lakhs', 'absolute', 'crores'] as ReportUnit[]).map(u => (
              <button key={u} onClick={() => mis.setUnit(u)}
                className="px-3 py-1.5 text-xs"
                style={{
                  background: mis.unit === u ? CHART_COLORS.teal : 'transparent',
                  color: mis.unit === u ? '#fff' : 'var(--text2)',
                }}>
                {u === 'lakhs' ? '₹L' : u === 'crores' ? '₹Cr' : 'Abs'}
              </button>
            ))}
          </div>
          {!hideExcel && (
            <button
              onClick={mis.triggerExcel}
              disabled={mis.exporting}
              className="text-xs px-3 py-2 rounded-lg font-semibold whitespace-nowrap"
              style={{ background: CHART_COLORS.teal, color: '#fff', opacity: mis.exporting ? 0.6 : 1 }}
            >
              {mis.exporting ? '⟳ Generating…' : '⬇ Excel'}
            </button>
          )}
          {action}
        </div>
      </div>
    </div>
  );
}
