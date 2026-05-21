'use client';

import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart,
  ResponsiveContainer, Tooltip as ReTip, XAxis, YAxis,
} from 'recharts';
import ReportLayout, { useMIS } from '../ReportLayout';
import {
  fmtINR, fmtPct, fmtResult, CHART_COLORS, CHART_GRID, CHART_AXIS,
  tooltipStyle, SectionPanel, ChartCard, StatBox, EmptyChart,
  AIObservationsPlaceholder,
} from '../atoms';

export default function MISReportCost() {
  return <ReportLayout><CostContent /></ReportLayout>;
}

function CostContent() {
  const { out, unit, traceToBackup } = useMIS();
  const costStructure = (out.byId['CA1']?.value?.breakdown ?? []).slice(0, 8);
  const fixedVar = out.byId['CA2']?.value?.breakdown ?? [];

  return (
    <SectionPanel title="Cost Analysis" accent="cost" blurb="Cost structure, break-even, and budget variance.">
      <div className="grid grid-cols-3 gap-3">
        <StatBox label="Break-even Revenue" value={fmtResult(out.byId['CA3'], unit)} tint="teal"   metricId="CA3" onTrace={traceToBackup} />
        <StatBox label="Operating Leverage"  value={fmtResult(out.byId['CA4'], unit)} tint="blue"   metricId="CA4" onTrace={traceToBackup} />
        <StatBox label="Employee Cost / Head" value={fmtResult(out.byId['CA6'], unit)} tint="purple" metricId="CA6" onTrace={traceToBackup} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <ChartCard title="Cost lines as % of revenue" height={260}>
          {costStructure.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={costStructure} layout="vertical" margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} horizontal={false} />
                <XAxis type="number" tickFormatter={(v: number) => `${v.toFixed(0)}%`} tick={{ fontSize: 10, fill: CHART_AXIS }} tickLine={false} axisLine={false} />
                <YAxis dataKey="label" type="category" tick={{ fontSize: 10, fill: CHART_AXIS }} tickLine={false} axisLine={false} width={120} />
                <ReTip formatter={(v) => fmtPct(typeof v === 'number' ? v : 0)} contentStyle={tooltipStyle} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {costStructure.map((_, i) => <Cell key={i} fill={Object.values(CHART_COLORS)[i % 7]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyChart message="P&L sections required" />}
        </ChartCard>

        <ChartCard title="Fixed vs Variable" height={260}>
          {fixedVar.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={fixedVar} dataKey="value" nameKey="label" innerRadius={50} outerRadius={80} paddingAngle={3} stroke="none">
                  <Cell fill={CHART_COLORS.coral} />
                  <Cell fill={CHART_COLORS.blue} />
                </Pie>
                <ReTip formatter={(v) => fmtINR(typeof v === 'number' ? v : 0, unit)} contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 10, color: 'var(--text2)' }} iconType="circle" />
              </PieChart>
            </ResponsiveContainer>
          ) : <EmptyChart message="Fixed/variable split requires P&L data" />}
        </ChartCard>
      </div>

      <AIObservationsPlaceholder section="Cost Analysis" />
    </SectionPanel>
  );
}
