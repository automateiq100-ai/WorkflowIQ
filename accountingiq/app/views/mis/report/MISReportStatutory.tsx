'use client';

import ReportLayout, { useMIS } from '../ReportLayout';
import {
  type ReportUnit, fmtINR, fmtResult, CHART_COLORS, SectionPanel,
  AIObservationsPlaceholder,
} from '../atoms';

export default function MISReportStatutory() {
  return <ReportLayout><StatutoryContent /></ReportLayout>;
}

function StatutoryContent() {
  const { out, unit, traceToBackup } = useMIS();
  const gst = out.byId['SC1']?.value?.breakdown ?? [];
  const tds = out.byId['SC4']?.value?.breakdown ?? [];
  const pfBreak = out.byId['SC7']?.value?.breakdown ?? [];
  const trace = traceToBackup;

  return (
    <SectionPanel title="Statutory & Compliance" accent="statutory" blurb="GST, TDS, PF/ESI/PT for the period.">
      <div className="grid grid-cols-3 gap-3">
        <StatCard title="GST Summary" tint="red">
          {gst.map((b, i) => (
            <Row key={i} label={`Output ${b.label}`} value={fmtINR(b.value, unit)} metricId="SC1" onTrace={trace} />
          ))}
          <Row label="Total Output GST" value={fmtResult(out.byId['SC1'], unit)} strong metricId="SC1" onTrace={trace} />
          <Row label="Input ITC" value={fmtResult(out.byId['SC2'], unit)} metricId="SC2" onTrace={trace} />
          <Row label="Net GST Payable" value={fmtResult(out.byId['SC3'], unit)} strong color={CHART_COLORS.red} metricId="SC3" onTrace={trace} />
        </StatCard>

        <StatCard title="TDS Summary" tint="amber">
          {tds.map((b, i) => (
            <Row key={i} label={b.label} value={fmtINR(b.value, unit)} metricId="SC4" onTrace={trace} />
          ))}
          <Row label="Total TDS Deducted" value={fmtResult(out.byId['SC4'], unit)} strong metricId="SC4" onTrace={trace} />
          <Row label="Deposited (DayBook)" value={fmtResult(out.byId['SC5'], unit)} metricId="SC5" onTrace={trace} />
        </StatCard>

        <StatCard title="PF / ESI / PT" tint="green">
          {pfBreak.map((b, i) => (
            <Row key={i} label={b.label} value={fmtINR(b.value, unit)} metricId="SC7" onTrace={trace} />
          ))}
          <Row label="Total PF + ESI" value={fmtResult(out.byId['SC7'], unit)} strong metricId="SC7" onTrace={trace} />
          <Row label="Professional Tax" value={fmtResult(out.byId['SC8'], unit)} metricId="SC8" onTrace={trace} />
          <Row label="Advance Tax (est)" value={fmtResult(out.byId['SC6'], unit)} metricId="SC6" onTrace={trace} />
        </StatCard>
      </div>

      <AIObservationsPlaceholder section="Statutory" />
    </SectionPanel>
  );
}

function StatCard({ title, tint, children }: { title: string; tint: keyof typeof CHART_COLORS; children: React.ReactNode }) {
  const c = CHART_COLORS[tint];
  return (
    <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
      <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wide" style={{ background: `${c}22`, color: c }}>{title}</div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function Row({ label, value, strong, color, metricId, onTrace }: {
  label: string;
  value: string;
  strong?: boolean;
  color?: string;
  metricId?: string;
  onTrace?: (id: string) => void;
}) {
  const clickable = !!(metricId && onTrace);
  return (
    <div
      className="flex justify-between items-center py-1.5 text-xs transition-colors"
      style={{
        borderTop: '1px solid var(--bg3)',
        cursor: clickable ? 'pointer' : 'default',
      }}
      onClick={() => clickable && onTrace!(metricId!)}
      title={clickable ? 'View working' : undefined}
    >
      <span style={{ color: 'var(--text3)' }}>{label}</span>
      <span className="tabular-nums" style={{ color: color ?? 'var(--text1)', fontWeight: strong ? 600 : 400 }}>{value}</span>
    </div>
  );
}
