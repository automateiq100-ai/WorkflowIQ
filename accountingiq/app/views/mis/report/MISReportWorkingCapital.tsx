'use client';

import ReportLayout, { useMIS } from '../ReportLayout';
import {
  type ReportUnit, fmtINR, CHART_COLORS, SectionPanel, MetricCard,
  ChartCard, AgingBar, EmptyChart, AIObservationsPlaceholder,
} from '../atoms';

export default function MISReportWorkingCapital() {
  return <ReportLayout><WCContent /></ReportLayout>;
}

function WCContent() {
  const { out, unit, violationsByMetricId, traceToBackup } = useMIS();
  const vm = violationsByMetricId;
  const debtors = out.byId['WC3']?.value?.breakdown ?? [];
  const creditors = out.byId['WC9']?.value?.breakdown ?? [];

  // Real bill-level aging — WC1 (debtors) / WC6 (creditors) bucket per-bill
  // outstanding by days-past-due against the period end / today.  When
  // Bills.xml isn't uploaded the metrics return missing-data, and we
  // fall back to the synthetic distribution below.
  const debtorAging = out.byId['WC1'];
  const creditorAging = out.byId['WC6'];
  const realDebtorAging = debtorAging?.status === 'computed' || debtorAging?.status === 'partial'
    ? debtorAging?.value?.breakdown ?? []
    : [];
  const realCreditorAging = creditorAging?.status === 'computed' || creditorAging?.status === 'partial'
    ? creditorAging?.value?.breakdown ?? []
    : [];
  const debtorAgingTotal = debtorAging?.value?.numeric ?? debtors.reduce((s, b) => s + b.value, 0);
  const creditorAgingTotal = creditorAging?.value?.numeric ?? creditors.reduce((s, b) => s + b.value, 0);

  /** Look up a labelled aging bucket from a metric's breakdown.  WC1/WC6
   *  emit labels like "0–30 days" / "31–60 days" / "61–90 days" / "90+ days"
   *  / "Not yet due"; missing buckets simply return 0. */
  const bucket = (rows: Array<{ label: string; value: number }>, key: string): number =>
    rows.find(r => r.label === key)?.value ?? 0;

  const haveRealDebtorAging = realDebtorAging.length > 0;
  const haveRealCreditorAging = realCreditorAging.length > 0;

  return (
    <SectionPanel title="Working Capital" accent="wc" blurb="Debtor / creditor cycle, inventory days, collection efficiency.">
      <div className="grid grid-cols-4 gap-3">
        <MetricCard label="DSO" result={out.byId['WC2']} unit={unit} accent="amber" violations={vm['WC2']} metricId="WC2" onTrace={traceToBackup} />
        <MetricCard label="DPO" result={out.byId['WC7']} unit={unit} accent="green" violations={vm['WC7']} metricId="WC7" onTrace={traceToBackup} />
        <MetricCard label="DIO" result={out.byId['WC10']} unit={unit} accent="purple" violations={vm['WC10']} metricId="WC10" onTrace={traceToBackup} />
        <MetricCard label="Cash Conversion Cycle" result={out.byId['WC12']} unit={unit} accent="teal" violations={vm['WC12']} metricId="WC12" onTrace={traceToBackup} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <ChartCard title={`Debtor aging — ${fmtINR(debtorAgingTotal, unit)} total`} height={170}>
          {haveRealDebtorAging ? (
            <div className="pt-2">
              {bucket(realDebtorAging, 'Not yet due') > 0 && (
                <AgingBar label="Not yet due" value={bucket(realDebtorAging, 'Not yet due')} total={debtorAgingTotal} color={CHART_COLORS.grey} unit={unit} metricId="WC1" onTrace={traceToBackup} />
              )}
              <AgingBar label="0–30 days"  value={bucket(realDebtorAging, '0–30 days')}  total={debtorAgingTotal} color={CHART_COLORS.green} unit={unit} metricId="WC1" onTrace={traceToBackup} />
              <AgingBar label="31–60 days" value={bucket(realDebtorAging, '31–60 days')} total={debtorAgingTotal} color={CHART_COLORS.amber} unit={unit} metricId="WC1" onTrace={traceToBackup} />
              <AgingBar label="61–90 days" value={bucket(realDebtorAging, '61–90 days')} total={debtorAgingTotal} color={CHART_COLORS.coral} unit={unit} metricId="WC1" onTrace={traceToBackup} />
              <AgingBar label="90+ days"   value={bucket(realDebtorAging, '90+ days')}   total={debtorAgingTotal} color={CHART_COLORS.red}   unit={unit} metricId="WC4" onTrace={traceToBackup} />
            </div>
          ) : debtors.length > 0 ? (
            <div className="pt-2">
              {/* Synthetic distribution — only used when Bills.xml is absent.  Flagged so the user knows it's an estimate, not real aging. */}
              <AgingBar label="0–30 days"  value={debtorAgingTotal * 0.52} total={debtorAgingTotal} color={CHART_COLORS.green} unit={unit} metricId="WC1" onTrace={traceToBackup} />
              <AgingBar label="31–60 days" value={debtorAgingTotal * 0.26} total={debtorAgingTotal} color={CHART_COLORS.amber} unit={unit} metricId="WC1" onTrace={traceToBackup} />
              <AgingBar label="61–90 days" value={debtorAgingTotal * 0.13} total={debtorAgingTotal} color={CHART_COLORS.coral} unit={unit} metricId="WC1" onTrace={traceToBackup} />
              <AgingBar label="90+ days"   value={debtorAgingTotal * 0.09} total={debtorAgingTotal} color={CHART_COLORS.red}   unit={unit} badge="estimate — upload Bills.xml" metricId="WC4" onTrace={traceToBackup} />
            </div>
          ) : <EmptyChart message="Debtor balances not parsed — upload TB / Bills.xml" />}
        </ChartCard>

        <ChartCard title={`Creditor aging — ${fmtINR(creditorAgingTotal, unit)} total`} height={170}>
          {haveRealCreditorAging ? (
            <div className="pt-2">
              {bucket(realCreditorAging, 'Not yet due') > 0 && (
                <AgingBar label="Not yet due" value={bucket(realCreditorAging, 'Not yet due')} total={creditorAgingTotal} color={CHART_COLORS.grey} unit={unit} metricId="WC6" onTrace={traceToBackup} />
              )}
              <AgingBar label="0–30 days"  value={bucket(realCreditorAging, '0–30 days')}  total={creditorAgingTotal} color={CHART_COLORS.green} unit={unit} metricId="WC6" onTrace={traceToBackup} />
              <AgingBar label="31–60 days" value={bucket(realCreditorAging, '31–60 days')} total={creditorAgingTotal} color={CHART_COLORS.amber} unit={unit} metricId="WC6" onTrace={traceToBackup} />
              <AgingBar label="61–90 days" value={bucket(realCreditorAging, '61–90 days')} total={creditorAgingTotal} color={CHART_COLORS.coral} unit={unit} metricId="WC6" onTrace={traceToBackup} />
              <AgingBar label="90+ days"   value={bucket(realCreditorAging, '90+ days')}   total={creditorAgingTotal} color={CHART_COLORS.red}   unit={unit} metricId="WC8" onTrace={traceToBackup} />
            </div>
          ) : creditors.length > 0 ? (
            <div className="pt-2">
              <AgingBar label="0–30 days"  value={creditorAgingTotal * 0.61} total={creditorAgingTotal} color={CHART_COLORS.green} unit={unit} metricId="WC6" onTrace={traceToBackup} />
              <AgingBar label="31–60 days" value={creditorAgingTotal * 0.28} total={creditorAgingTotal} color={CHART_COLORS.amber} unit={unit} metricId="WC6" onTrace={traceToBackup} />
              <AgingBar label="61–90 days" value={creditorAgingTotal * 0.08} total={creditorAgingTotal} color={CHART_COLORS.coral} unit={unit} metricId="WC8" onTrace={traceToBackup} />
              <AgingBar label="90+ days"   value={creditorAgingTotal * 0.03} total={creditorAgingTotal} color={CHART_COLORS.red}   unit={unit} badge="estimate — upload Payables.xml" metricId="WC8" onTrace={traceToBackup} />
            </div>
          ) : <EmptyChart message="Creditor balances not parsed" />}
        </ChartCard>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <TopList title="Top 10 Debtors" items={debtors.slice(0, 10)} unit={unit} accent={CHART_COLORS.coral} metricId="WC3" onTrace={traceToBackup} />
        <TopList title="Top 10 Creditors" items={creditors.slice(0, 10)} unit={unit} accent={CHART_COLORS.green} metricId="WC9" onTrace={traceToBackup} />
      </div>

      <AIObservationsPlaceholder section="Working Capital" />
    </SectionPanel>
  );
}

function TopList({ title, items, unit, accent, metricId, onTrace }: {
  title: string;
  items: Array<{ label: string; value: number; badge?: string }>;
  unit: ReportUnit;
  accent: string;
  metricId?: string;
  onTrace?: (id: string) => void;
}) {
  const clickable = !!(metricId && onTrace);
  return (
    <div className="rounded-xl border" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
      <div className="px-4 py-2 border-b text-xs font-semibold flex items-center justify-between"
        style={{ borderColor: 'var(--border)', color: 'var(--text2)' }}>
        <span>{title}</span>
        {clickable && (
          <button onClick={() => onTrace!(metricId!)}
            className="text-[10px] font-normal hover:underline"
            style={{ color: accent }}
            title="View working">
            View working →
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <div className="p-4 text-xs text-center" style={{ color: 'var(--text3)' }}>No data</div>
      ) : (
        <table className="w-full text-xs">
          <tbody>
            {items.map((b, i) => (
              <tr key={i}
                className="border-t transition-colors hover:bg-[var(--bg3)]"
                style={{ borderColor: 'var(--border)', cursor: clickable ? 'pointer' : 'default' }}
                onClick={() => clickable && onTrace!(metricId!)}
                title={clickable ? 'View working' : undefined}>
                <td className="px-3 py-1.5 tabular-nums w-6" style={{ color: 'var(--text3)' }}>{i + 1}</td>
                <td className="px-3 py-1.5" style={{ color: 'var(--text1)' }}>{b.label}</td>
                <td className="px-3 py-1.5 text-right tabular-nums font-semibold" style={{ color: accent }}>{fmtINR(b.value, unit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
