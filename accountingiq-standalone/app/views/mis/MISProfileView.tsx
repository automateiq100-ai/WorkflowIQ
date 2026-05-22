'use client';

/**
 * MIS Company Profile — sector selection, manual inputs, and the
 * 73-metric checklist with enable/disable.  Replaces what used to live in
 * the old MISReportView "Setup" tab.
 *
 * Three sections:
 *   1. Sector pick — drives sector add-on metrics + benchmark defaults
 *   2. Manual inputs — headcount, order book, drawing power, covenants…
 *   3. Metric selection — toggle each of the 73 metrics on/off (drives
 *      MIS Score denominator).
 *
 * Budget Excel upload lives in Upload Files, not here.
 */

import { useApp } from '@/lib/state';
import type { MISSector } from '@/lib/types';
import type { ManualInputs } from '@/lib/layer2/types';
import { MIS_DOMAINS, ALL_MIS_METRICS } from '@/lib/layer2/mis/metrics';
import '@/lib/layer2/mis/metric-inputs';
import { CHART_COLORS } from './atoms';

const SECTORS: MISSector[] = ['Manufacturing', 'Trading', 'Services', 'Retail', 'Construction', 'Financial Services', 'Hospitality', 'IT/SaaS'];

const STATUS_TINT: Record<string, { bg: string; fg: string; label: string }> = {
  auto:      { bg: 'rgba(76,175,121,0.12)',  fg: CHART_COLORS.green,  label: '✓ Auto' },
  partial:   { bg: 'rgba(245,166,35,0.12)',  fg: CHART_COLORS.amber,  label: '◐ Partial' },
  manual:    { bg: 'rgba(242,107,91,0.12)',  fg: CHART_COLORS.coral,  label: '✎ Manual' },
  'new-xml': { bg: 'rgba(240,72,72,0.12)',   fg: CHART_COLORS.red,    label: '📎 New XML' },
};

export default function MISProfileView() {
  const { state, dispatch } = useApp();
  const { misSetup, misManualInputs } = state;
  const inputs = misManualInputs ?? {};

  const allMetricIds = ALL_MIS_METRICS.map(m => m.id);
  const selectedIds = misSetup.selectedMetricIds.length > 0
    ? misSetup.selectedMetricIds
    : allMetricIds;

  const toggleMetric = (id: string) => {
    const next = selectedIds.includes(id)
      ? selectedIds.filter(x => x !== id)
      : [...selectedIds, id];
    dispatch({ type: 'MIS_SETUP_UPDATED', misSetup: { selectedMetricIds: next } });
  };

  const updateManual = (patch: Partial<ManualInputs>) => {
    dispatch({ type: 'MIS_MANUAL_INPUTS_SET', inputs: patch });
  };

  return (
    <div className="max-w-5xl mx-auto animate-fade-in space-y-5">
      <div>
        <h1 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>
          Company Profile
        </h1>
        <p className="text-xs mt-1" style={{ color: 'var(--text3)' }}>
          MIS-specific profile — sector, manual inputs, and which of the 73 metrics matter for this company.
        </p>
      </div>

      {/* Sector */}
      <Card title="Primary Business Sector" subtitle="Drives sector-specific add-on metrics and benchmark defaults.">
        <div className="grid grid-cols-4 gap-2">
          {SECTORS.map(s => (
            <button key={s}
              onClick={() => dispatch({ type: 'MIS_SETUP_UPDATED', misSetup: { sector: s } })}
              className="px-3 py-2 rounded-lg text-xs text-center border transition-all"
              style={{
                background: misSetup.sector === s ? `${CHART_COLORS.teal}22` : 'var(--bg3)',
                borderColor: misSetup.sector === s ? CHART_COLORS.teal : 'var(--border)',
                color: misSetup.sector === s ? CHART_COLORS.teal : 'var(--text2)',
                fontWeight: misSetup.sector === s ? 600 : 400,
              }}>
              {s}
            </button>
          ))}
        </div>
      </Card>

      {/* Manual inputs */}
      <Card title="Manual Inputs" subtitle="Numbers that have no Tally source. All optional — leave blank to skip those metrics.">
        <div className="grid grid-cols-2 gap-3">
          <NumField label="Current Headcount" hint="Cost-per-head metric"
            value={inputs.headcount} onChange={v => updateManual({ headcount: v ?? undefined })} suffix="employees" />
          <NumField label="Order Book Value" hint="Confirmed pipeline / order book"
            value={inputs.orderBook} onChange={v => updateManual({ orderBook: v ?? undefined })} suffix="₹" />
          <NumField label="Drawing Power / Sanctioned Limit" hint="From bank sanction letter"
            value={inputs.drawingPowerLimit} onChange={v => updateManual({ drawingPowerLimit: v ?? undefined })} suffix="₹" />
          <NumField label="Contingent Liabilities" hint="Guarantees, disputes, litigation"
            value={inputs.contingentLiabilities} onChange={v => updateManual({ contingentLiabilities: v ?? undefined })} suffix="₹" />
          <NumField label="Production Qty (this period)" hint="Manufacturing only"
            value={inputs.productionQty} onChange={v => updateManual({ productionQty: v ?? undefined })} suffix="units" />
        </div>

        <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--border)' }}>
          <div className="text-xs font-semibold mb-3" style={{ color: 'var(--text2)' }}>Loan covenants (from sanction letter)</div>
          <div className="grid grid-cols-3 gap-3">
            <NumField label="DSCR min" inline
              value={inputs.covenants?.dscrMin}
              onChange={v => updateManual({ covenants: { ...inputs.covenants, dscrMin: v ?? undefined } })} suffix="×" />
            <NumField label="D/E max" inline
              value={inputs.covenants?.deRatioMax}
              onChange={v => updateManual({ covenants: { ...inputs.covenants, deRatioMax: v ?? undefined } })} suffix="×" />
            <NumField label="Current ratio min" inline
              value={inputs.covenants?.currentRatioMin}
              onChange={v => updateManual({ covenants: { ...inputs.covenants, currentRatioMin: v ?? undefined } })} suffix="×" />
          </div>
        </div>
      </Card>

      {/* Metric selection */}
      <Card title={`Relevant Metrics — ${selectedIds.length} of ${allMetricIds.length} selected`}
        subtitle="Deselect metrics that don't apply. Deselected metrics are excluded from the readiness score and the MIS report.">
        <div className="flex justify-end gap-2 mb-3">
          <button onClick={() => dispatch({ type: 'MIS_SETUP_UPDATED', misSetup: { selectedMetricIds: allMetricIds } })}
            className="text-xs px-2 py-1 rounded border"
            style={{ borderColor: 'var(--border)', color: CHART_COLORS.teal }}>
            Select all
          </button>
          <button onClick={() => dispatch({ type: 'MIS_SETUP_UPDATED', misSetup: { selectedMetricIds: [] } })}
            className="text-xs px-2 py-1 rounded border"
            style={{ borderColor: 'var(--border)', color: 'var(--text3)' }}>
            Clear
          </button>
        </div>
        <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
          {MIS_DOMAINS.map(domain => (
            <div key={domain.id} className="border-b" style={{ borderColor: 'var(--border)' }}>
              <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wider" style={{ background: 'var(--bg3)', color: 'var(--text3)' }}>
                {domain.label}
              </div>
              {domain.metrics.map(m => {
                const tint = STATUS_TINT[m.defaultStatus];
                return (
                  <label key={m.id} className="flex items-center gap-3 px-4 py-2 border-b cursor-pointer" style={{ borderColor: 'var(--bg3)' }}>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(m.id)}
                      onChange={() => toggleMetric(m.id)}
                      className="shrink-0"
                      style={{ accentColor: CHART_COLORS.teal }}
                    />
                    <div className="flex-1 text-xs" style={{ color: 'var(--text1)' }}>{m.label}</div>
                    <span className="shrink-0 text-xs px-1.5 py-0.5 rounded font-medium" style={{ background: tint.bg, color: tint.fg }}>
                      {tint.label}
                    </span>
                  </label>
                );
              })}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border p-5" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
      <div className="text-sm font-semibold mb-1" style={{ color: 'var(--text1)' }}>{title}</div>
      {subtitle && <div className="text-xs mb-4" style={{ color: 'var(--text3)' }}>{subtitle}</div>}
      {children}
    </div>
  );
}

function NumField({ label, hint, value, onChange, suffix, inline }: {
  label: string;
  hint?: string;
  value?: number;
  onChange: (v: number | null) => void;
  suffix?: string;
  inline?: boolean;
}) {
  return (
    <div className={inline ? '' : 'rounded-lg border p-3'} style={inline ? {} : { background: 'var(--bg3)', borderColor: 'var(--border)' }}>
      <div className={inline ? 'text-xs mb-1' : 'text-xs font-semibold mb-1'} style={{ color: 'var(--text1)' }}>{label}</div>
      {!inline && hint && <div className="text-[10px] mb-2" style={{ color: 'var(--text3)' }}>{hint}</div>}
      <div className="flex items-center gap-2">
        <input type="number"
          value={value ?? ''}
          onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
          className="flex-1 px-2 py-1.5 rounded border text-sm tabular-nums"
          style={{ background: inline ? 'var(--bg3)' : 'var(--bg2)', borderColor: 'var(--border)', color: 'var(--text1)' }} />
        {suffix && <span className="text-xs" style={{ color: 'var(--text3)' }}>{suffix}</span>}
      </div>
    </div>
  );
}
