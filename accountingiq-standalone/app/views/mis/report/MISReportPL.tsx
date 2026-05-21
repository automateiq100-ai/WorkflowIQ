'use client';

import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie,
  PieChart, ResponsiveContainer, Tooltip as ReTip, XAxis, YAxis,
} from 'recharts';
import ReportLayout, { useMIS } from '../ReportLayout';
import {
  fmtINR, fmtPct, fmtResult, CHART_COLORS, CHART_GRID, CHART_AXIS,
  tooltipStyle, SectionPanel, MetricCard, StatusPill, ChartCard, EmptyChart,
  AIObservationsPlaceholder,
} from '../atoms';
import { ALL_MIS_METRICS } from '@/lib/layer2/mis/metrics';

export default function MISReportPL() {
  return <ReportLayout><PLContent /></ReportLayout>;
}

function PLContent() {
  const { out, unit, violationsByMetricId, traceToBackup } = useMIS();
  const vm = violationsByMetricId;
  // Multi-period P&L trend for revenue + PAT (when history has >= 2 periods).
  const revTrend = out.byId['P1']?.value?.trend ?? [];
  const patTrend = out.byId['P7']?.value?.trend ?? [];
  const plTrendData = revTrend.length >= 2 ? revTrend.map((r, i) => ({
    label: r.periodLabel,
    revenue: r.value,
    pat: patTrend[i]?.value,
  })) : [];

  const revenue = out.byId['P1']?.value?.numeric ?? 0;
  const gp = out.byId['P5']?.value?.numeric ?? 0;
  const cogs = Math.max(0, revenue - gp);
  const ebitda = out.byId['P6']?.value?.numeric ?? 0;
  const opex = Math.max(0, gp - ebitda);
  const pat = out.byId['P7']?.value?.numeric ?? 0;
  const dInt = Math.max(0, ebitda - pat);

  const waterfall = [
    { name: 'Revenue', value: revenue, fill: CHART_COLORS.teal },
    { name: 'COGS', value: cogs, fill: CHART_COLORS.red },
    { name: 'Gross Profit', value: gp, fill: CHART_COLORS.teal },
    { name: 'OpEx', value: opex, fill: CHART_COLORS.red },
    { name: 'EBITDA', value: ebitda, fill: CHART_COLORS.teal },
    { name: 'D&A + Int', value: dInt, fill: CHART_COLORS.red },
    { name: 'PAT', value: pat, fill: CHART_COLORS.green },
  ].filter(b => b.value > 0);

  const segments = out.byId['P4']?.value?.breakdown ?? [];

  return (
    <SectionPanel title="Profit & Loss" accent="pl" blurb="Revenue, costs, and margin breakdown for the period.">
      <div className="grid grid-cols-4 gap-3">
        <MetricCard label="Revenue" result={out.byId['P1']} unit={unit} accent="teal" violations={vm['P1']} metricId="P1" onTrace={traceToBackup} />
        <MetricCard label="Gross Profit & GM%" result={out.byId['P5']} unit={unit} accent="blue" violations={vm['P5']} metricId="P5" onTrace={traceToBackup} />
        <MetricCard label="EBITDA & Margin" result={out.byId['P6']} unit={unit} accent="purple" violations={vm['P6']} metricId="P6" onTrace={traceToBackup} />
        <MetricCard label="Net Profit (PAT)" result={out.byId['P7']} unit={unit} accent="green" violations={vm['P7']} metricId="P7" onTrace={traceToBackup} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <ChartCard title="P&L waterfall" height={240}>
          {waterfall.length >= 2 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={waterfall} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 9, fill: CHART_AXIS }} tickLine={false} axisLine={false} interval={0} />
                <YAxis tickFormatter={(v: number) => fmtINR(v, unit, false)} tick={{ fontSize: 10, fill: CHART_AXIS }} tickLine={false} axisLine={false} />
                <ReTip formatter={(v) => fmtINR(typeof v === 'number' ? v : 0, unit)} contentStyle={tooltipStyle} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {waterfall.map((b, i) => <Cell key={i} fill={b.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyChart message="Waterfall needs revenue + cost data" />}
        </ChartCard>

        <ChartCard title="Revenue by segment" height={240}>
          {segments.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={segments} dataKey="value" nameKey="label" innerRadius={50} outerRadius={80} paddingAngle={2} stroke="none">
                  {segments.map((_, i) => <Cell key={i} fill={Object.values(CHART_COLORS)[i % 7]} />)}
                </Pie>
                <ReTip formatter={(v) => fmtINR(typeof v === 'number' ? v : 0, unit)} contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 10, color: 'var(--text2)' }} iconType="circle" />
              </PieChart>
            </ResponsiveContainer>
          ) : <EmptyChart message="Multiple sales ledgers required — currently a single revenue line" />}
        </ChartCard>
      </div>

      <ChartCard title="P&L line items" height={310}>
        <div className="overflow-x-auto h-full">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ background: 'var(--bg3)' }}>
                <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--text3)' }}>Particulars</th>
                <th className="text-right px-3 py-2 font-medium" style={{ color: 'var(--text3)' }}>Value</th>
                <th className="text-right px-3 py-2 font-medium" style={{ color: 'var(--text3)' }}>% of Revenue</th>
                <th className="text-right px-3 py-2 font-medium" style={{ color: 'var(--text3)' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {(['P1', 'P5', 'P6', 'P7', 'P2', 'P9', 'P10', 'P3', 'P8'] as const).map(id => {
                const def = ALL_MIS_METRICS.find(m => m.id === id);
                const r = out.byId[id];
                if (!def || !r) return null;
                const v = r.value?.numeric;
                const pct = revenue > 0 && v != null && r.value?.unit !== 'pct' ? (v / revenue) * 100 : null;
                return (
                  <tr key={id} className="border-t cursor-pointer hover:bg-[var(--bg3)] transition-colors"
                    style={{ borderColor: 'var(--border)' }}
                    onClick={() => traceToBackup(id)}
                    title="View working">
                    <td className="px-3 py-2" style={{ color: 'var(--text1)' }}>{def.label}</td>
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: 'var(--text1)' }}>{fmtResult(r, unit)}</td>
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: 'var(--text3)' }}>{pct != null ? fmtPct(pct) : '—'}</td>
                    <td className="px-3 py-2 text-right"><StatusPill status={r.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </ChartCard>

      {plTrendData.length >= 2 && (
        <ChartCard title="12-month P&L trend — Revenue + PAT" height={260}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={plTrendData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: CHART_AXIS }} tickLine={false} axisLine={false} />
              <YAxis tickFormatter={(v: number) => fmtINR(v, unit, false)} tick={{ fontSize: 10, fill: CHART_AXIS }} tickLine={false} axisLine={false} />
              <ReTip formatter={(v) => fmtINR(typeof v === 'number' ? v : 0, unit)} contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 10, color: 'var(--text2)' }} iconType="circle" />
              <Bar dataKey="revenue" name="Revenue" fill={CHART_COLORS.teal} radius={[4, 4, 0, 0]} barSize={20} />
              <Line type="monotone" dataKey="pat" name="PAT" stroke={CHART_COLORS.green} strokeWidth={2} dot={{ fill: CHART_COLORS.green, r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      <AIObservationsPlaceholder section="P&L" />
    </SectionPanel>
  );
}
