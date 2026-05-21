'use client';

import {
  Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer,
  Tooltip as ReTip, XAxis, YAxis,
} from 'recharts';
import ReportLayout, { useMIS } from '../ReportLayout';
import {
  fmtINR, fmtResult, CHART_COLORS, CHART_GRID, CHART_AXIS,
  tooltipStyle, SectionPanel, MetricCard, StatusPill,
  ChartCard, StatBox, EmptyChart, AIObservationsPlaceholder,
} from '../atoms';
import { ALL_MIS_METRICS } from '@/lib/layer2/mis/metrics';

export default function MISReportCashFlow() {
  return <ReportLayout><CashFlowContent /></ReportLayout>;
}

function CashFlowContent() {
  const { out, unit, violationsByMetricId, traceToBackup } = useMIS();
  const vm = violationsByMetricId;
  const banks = out.byId['CF3']?.value?.breakdown ?? [];
  const outflows = out.byId['CF10']?.value?.breakdown ?? [];
  // Multi-period cash position + OCF composed trend.
  const cashTrend = out.byId['CF1']?.value?.trend ?? [];
  const ocfTrend = out.byId['CF4']?.value?.trend ?? [];
  const composed = cashTrend.length >= 2 ? cashTrend.map((r, i) => ({
    label: r.periodLabel, cash: r.value, ocf: ocfTrend[i]?.value,
  })) : [];

  return (
    <SectionPanel title="Cash Flow" accent="cf" blurb="Operating / investing / financing flows + bank-wise balance + commitments.">
      <div className="grid grid-cols-4 gap-3">
        <MetricCard label="Closing Cash & Bank" result={out.byId['CF1']} unit={unit} accent="teal" violations={vm['CF1']} metricId="CF1" onTrace={traceToBackup} />
        <MetricCard label="Net Cash Movement" result={out.byId['CF2']} unit={unit} accent="blue" violations={vm['CF2']} metricId="CF2" onTrace={traceToBackup} />
        <MetricCard label="Operating Cash Flow" result={out.byId['CF4']} unit={unit} accent="green" violations={vm['CF4']} metricId="CF4" onTrace={traceToBackup} />
        <MetricCard label="Free Cash Flow" result={out.byId['CF7']} unit={unit} accent="purple" violations={vm['CF7']} metricId="CF7" onTrace={traceToBackup} />
      </div>

      {banks.length > 0 && (
        <div>
          <div className="text-xs font-semibold mb-2" style={{ color: 'var(--text2)' }}>Bank-wise closing balance</div>
          <div className="grid grid-cols-3 gap-3">
            {banks.slice(0, 6).map((b, i) => {
              const overdraft = b.value < 0;
              // Tint matches the balance sign: Dr (asset) = teal, Cr / overdraft = red.
              const valueColor = overdraft ? CHART_COLORS.red : CHART_COLORS.teal;
              const borderColor = overdraft ? `${CHART_COLORS.red}55` : 'var(--border)';
              const bgColor = overdraft ? `${CHART_COLORS.red}08` : 'var(--bg2)';
              return (
                <div key={i} className="rounded-xl border p-4" style={{ background: bgColor, borderColor }}>
                  <div className="text-xs mb-1 flex items-center justify-between" style={{ color: 'var(--text2)' }}>
                    <span>{b.label}</span>
                    {overdraft && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold"
                        style={{ background: `${CHART_COLORS.red}22`, color: CHART_COLORS.red }}>OD</span>
                    )}
                  </div>
                  <div className="text-lg font-bold tabular-nums" style={{ color: valueColor }}>{fmtINR(b.value, unit)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {outflows.length > 0 && (
        <div>
          <div className="text-xs font-semibold mb-2" style={{ color: 'var(--text2)' }}>Committed outflows — next 90 days</div>
          <div className="grid grid-cols-3 gap-3">
            {outflows.slice(0, 3).map((b, i) => {
              const tint = i === 0 ? 'red' : i === 1 ? 'amber' : 'green';
              return <StatBox key={i} label={b.label} value={fmtINR(b.value, unit)} tint={tint} />;
            })}
          </div>
        </div>
      )}

      <ChartCard title="Cash flow movements" height={260}>
        <div className="overflow-x-auto h-full">
          <table className="w-full text-xs">
            <thead><tr style={{ background: 'var(--bg3)' }}>
              <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--text3)' }}>Component</th>
              <th className="text-right px-3 py-2 font-medium" style={{ color: 'var(--text3)' }}>Value</th>
              <th className="text-right px-3 py-2 font-medium" style={{ color: 'var(--text3)' }}>Status</th>
            </tr></thead>
            <tbody>
              {(['CF4', 'CF5', 'CF6', 'CF7', 'CF2', 'CF9'] as const).map(id => {
                const def = ALL_MIS_METRICS.find(m => m.id === id);
                const r = out.byId[id];
                if (!def || !r) return null;
                return (
                  <tr key={id} className="border-t cursor-pointer hover:bg-[var(--bg3)] transition-colors"
                    style={{ borderColor: 'var(--border)' }}
                    onClick={() => traceToBackup(id)}
                    title="View working">
                    <td className="px-3 py-2" style={{ color: 'var(--text1)' }}>{def.label}</td>
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: 'var(--text1)' }}>{fmtResult(r, unit)}</td>
                    <td className="px-3 py-2 text-right"><StatusPill status={r.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </ChartCard>

      {composed.length >= 2 && (
        <ChartCard title="Cash position & operating cash flow" height={260}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={composed} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: CHART_AXIS }} tickLine={false} axisLine={false} />
              <YAxis tickFormatter={(v: number) => fmtINR(v, unit, false)} tick={{ fontSize: 10, fill: CHART_AXIS }} tickLine={false} axisLine={false} />
              <ReTip formatter={(v) => fmtINR(typeof v === 'number' ? v : 0, unit)} contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 10, color: 'var(--text2)' }} iconType="circle" />
              <Bar dataKey="cash" name="Cash balance" fill={CHART_COLORS.teal} radius={[4, 4, 0, 0]} barSize={24} />
              <Line type="monotone" dataKey="ocf" name="OCF" stroke={CHART_COLORS.green} strokeWidth={2} dot={{ fill: CHART_COLORS.green, r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      <AIObservationsPlaceholder section="Cash Flow" />
    </SectionPanel>
  );
}
