'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { useApp } from '@/lib/state';
import ReportLayout, { useMIS } from '../ReportLayout';
import {
  CHART_COLORS, fmtResult, fmtINR, SectionPanel, StatusPill, SECTION_ACCENT,
} from '../atoms';
import { ALL_MIS_METRICS } from '@/lib/layer2/mis/metrics';

const DOMAIN_TINT: Record<string, string> = {
  D1: SECTION_ACCENT.pl.bg,
  D2: SECTION_ACCENT.cf.bg,
  D3: SECTION_ACCENT.wc.bg,
  D4: SECTION_ACCENT.statutory.bg,
  D5: SECTION_ACCENT.bs.bg,
  D6: SECTION_ACCENT.cost.bg,
  D7: SECTION_ACCENT.bpi.bg,
};

export default function MISReportBackup() {
  return <ReportLayout><BackupContent /></ReportLayout>;
}

function BackupContent() {
  const { out, unit } = useMIS();
  const { state, dispatch } = useApp();
  const focusId = state.misBackupFocusMetricId;
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});

  // Scroll to the focused row when arriving via "View working" hyperlink.
  // The row gets a brief teal outline pulse so the user can spot it.
  useEffect(() => {
    if (!focusId) return;
    const el = rowRefs.current[focusId];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    // Clear focus once highlight has had time to register so re-entering
    // the view fresh doesn't keep glowing the same row.
    const t = setTimeout(() => dispatch({ type: 'MIS_BACKUP_FOCUS', metricId: null }), 2500);
    return () => clearTimeout(t);
  }, [focusId, dispatch]);

  return (
    <SectionPanel title="Backup Working" accent="backup" blurb="Every metric — formula, source, computed value, status. Click 'View working' on any KPI tile to jump straight to its row.">
      <div className="rounded-xl border overflow-x-auto" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
        <table className="w-full text-xs">
          <thead style={{ background: 'var(--bg3)' }}>
            <tr>
              <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--text3)' }}>ID</th>
              <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--text3)' }}>Metric</th>
              <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--text3)' }}>Formula</th>
              <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--text3)' }}>Source</th>
              <th className="text-right px-3 py-2 font-medium" style={{ color: 'var(--text3)' }}>Value</th>
              <th className="text-right px-3 py-2 font-medium" style={{ color: 'var(--text3)' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {ALL_MIS_METRICS.flatMap(m => {
              const r = out.byId[m.id];
              const focused = focusId === m.id;
              const breakdown = r?.value?.breakdown ?? [];
              const rows: ReactNode[] = [
                <tr key={m.id}
                  ref={(el) => { rowRefs.current[m.id] = el; }}
                  className="border-t transition-colors"
                  style={{
                    borderColor: 'var(--border)',
                    background: focused ? `${CHART_COLORS.teal}25` : DOMAIN_TINT[m.domainId],
                    outline: focused ? `2px solid ${CHART_COLORS.teal}` : 'none',
                  }}>
                  <td className="px-3 py-2 tabular-nums" style={{ color: 'var(--text3)' }}>{m.id}</td>
                  <td className="px-3 py-2" style={{ color: 'var(--text1)' }}>{m.label}</td>
                  <td className="px-3 py-2 font-mono text-[10px]" style={{ color: 'var(--text2)' }}>{r?.formula ?? m.formula ?? '—'}</td>
                  <td className="px-3 py-2" style={{ color: 'var(--text2)' }}>{r?.source ?? m.source}</td>
                  <td className="px-3 py-2 text-right tabular-nums" style={{ color: 'var(--text1)' }}>{fmtResult(r, unit)}</td>
                  <td className="px-3 py-2 text-right"><StatusPill status={r?.status ?? 'missing-data'} /></td>
                </tr>,
              ];
              // Render the metric's breakdown rows beneath — gives the user
              // the line-level numeric working without a second click.
              for (let i = 0; i < breakdown.length; i++) {
                const b = breakdown[i];
                const negative = typeof b.value === 'number' && b.value < 0;
                const isNet = b.badge === 'NET';
                const isSeparator = b.label.startsWith('—') && b.value === 0;
                rows.push(
                  <tr key={`${m.id}-bd-${i}`} className="border-t" style={{ borderColor: 'var(--border)', background: DOMAIN_TINT[m.domainId] }}>
                    <td className="px-3 py-1" />
                    <td className="px-3 py-1 text-[11px] pl-8" colSpan={3}
                      style={{
                        color: isSeparator ? 'var(--text3)' : 'var(--text2)',
                        fontStyle: isSeparator ? 'italic' : 'normal',
                        fontWeight: isNet ? 600 : 400,
                      }}>
                      {b.label}
                      {b.badge && b.badge !== 'NET' && (
                        <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded font-semibold"
                          style={{
                            background: b.badge === 'OD' ? `${CHART_COLORS.red}22` : `${CHART_COLORS.teal}22`,
                            color: b.badge === 'OD' ? CHART_COLORS.red : CHART_COLORS.teal,
                          }}>{b.badge}</span>
                      )}
                    </td>
                    <td className="px-3 py-1 text-right tabular-nums text-[11px]"
                      style={{
                        color: isSeparator ? 'var(--text3)'
                             : negative ? CHART_COLORS.red
                             : (isNet ? 'var(--text1)' : 'var(--text2)'),
                        fontWeight: isNet ? 600 : 400,
                      }}>
                      {isSeparator ? '' : fmtINR(b.value, unit)}
                    </td>
                    <td className="px-3 py-1" />
                  </tr>
                );
              }
              return rows;
            })}
          </tbody>
        </table>
      </div>
    </SectionPanel>
  );
}
