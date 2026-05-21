'use client';

import {
  Bar, BarChart, CartesianGrid, CartesianGrid as CG, Cell, Legend, Line,
  LineChart, Pie, PieChart, ResponsiveContainer, Tooltip as ReTip,
  XAxis, YAxis,
} from 'recharts';
import ReportLayout, { useMIS } from '../ReportLayout';
import {
  fmtINR, CHART_COLORS, CHART_GRID, CHART_AXIS,
  tooltipStyle, SectionPanel, MetricCard, ChartCard, EmptyChart,
  AIObservationsPlaceholder,
} from '../atoms';

export default function MISReportBPI() {
  return <ReportLayout><BPIContent /></ReportLayout>;
}

function BPIContent() {
  const { out, unit, violationsByMetricId, traceToBackup } = useMIS();
  const vm = violationsByMetricId;
  const customers = (out.byId['BPI1']?.value?.breakdown ?? []).slice(0, 10);
  const vendors = (out.byId['BPI8']?.value?.breakdown ?? []).slice(0, 10);
  const atvTrend = out.byId['BPI5']?.value?.trend ?? [];
  const newRepeat = out.byId['BPI3']?.value?.breakdown ?? [];

  return (
    <SectionPanel title="Business Performance" accent="bpi" blurb="Customer / vendor concentration, transaction value, returns.">
      <div className="grid grid-cols-3 gap-3">
        <MetricCard label="Top 3 Customer Concentration" result={out.byId['BPI1']} unit={unit} accent="red" violations={vm['BPI1']} metricId="BPI1" onTrace={traceToBackup} />
        <MetricCard label="Top 3 Vendor Concentration" result={out.byId['BPI8']} unit={unit} accent="amber" violations={vm['BPI8']} metricId="BPI8" onTrace={traceToBackup} />
        <MetricCard label="Avg Transaction Value" result={out.byId['BPI5']} unit={unit} accent="teal" violations={vm['BPI5']} metricId="BPI5" onTrace={traceToBackup} />
        <MetricCard label="Sales Return Rate" result={out.byId['BPI7']} unit={unit} accent="coral" violations={vm['BPI7']} metricId="BPI7" onTrace={traceToBackup} />
        <MetricCard label="New vs Repeat Revenue" result={out.byId['BPI3']} unit={unit} accent="green" violations={vm['BPI3']} metricId="BPI3" onTrace={traceToBackup} />
        <MetricCard label="DSCR" result={out.byId['BPI10']} unit={unit} accent="blue" violations={vm['BPI10']} metricId="BPI10" onTrace={traceToBackup} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <ChartCard title="Top 10 customers by sales" height={300}>
          {customers.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={customers} layout="vertical" margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} horizontal={false} />
                <XAxis type="number" tickFormatter={(v: number) => fmtINR(v, unit, false)} tick={{ fontSize: 10, fill: CHART_AXIS }} tickLine={false} axisLine={false} />
                <YAxis dataKey="label" type="category" tick={{ fontSize: 10, fill: CHART_AXIS }} tickLine={false} axisLine={false} width={120} />
                <ReTip formatter={(v) => fmtINR(typeof v === 'number' ? v : 0, unit)} contentStyle={tooltipStyle} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]} fill={CHART_COLORS.green} />
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyChart message="No customer data — DayBook required" />}
        </ChartCard>

        <ChartCard title="Top 10 vendors by purchases" height={300}>
          {vendors.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={vendors} layout="vertical" margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                <CG strokeDasharray="3 3" stroke={CHART_GRID} horizontal={false} />
                <XAxis type="number" tickFormatter={(v: number) => fmtINR(v, unit, false)} tick={{ fontSize: 10, fill: CHART_AXIS }} tickLine={false} axisLine={false} />
                <YAxis dataKey="label" type="category" tick={{ fontSize: 10, fill: CHART_AXIS }} tickLine={false} axisLine={false} width={120} />
                <ReTip formatter={(v) => fmtINR(typeof v === 'number' ? v : 0, unit)} contentStyle={tooltipStyle} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]} fill={CHART_COLORS.amber} />
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyChart message="No vendor data — DayBook required" />}
        </ChartCard>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <ChartCard title="New vs repeat customer revenue" height={240}>
          {newRepeat.length === 2 ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={newRepeat} dataKey="value" nameKey="label" innerRadius={50} outerRadius={80} paddingAngle={3} stroke="none">
                  <Cell fill={CHART_COLORS.teal} />
                  <Cell fill={CHART_COLORS.blue} />
                </Pie>
                <ReTip formatter={(v) => fmtINR(typeof v === 'number' ? v : 0, unit)} contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 10, color: 'var(--text2)' }} iconType="circle" />
              </PieChart>
            </ResponsiveContainer>
          ) : <EmptyChart message="Needs ≥ 2 periods to identify new vs repeat customers" />}
        </ChartCard>

        <ChartCard title="Average transaction value trend" height={240}>
          {atvTrend.length >= 2 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={atvTrend} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                <XAxis dataKey="periodLabel" tick={{ fontSize: 10, fill: CHART_AXIS }} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={(v: number) => fmtINR(v, unit, false)} tick={{ fontSize: 10, fill: CHART_AXIS }} tickLine={false} axisLine={false} />
                <ReTip formatter={(v) => fmtINR(typeof v === 'number' ? v : 0, unit)} contentStyle={tooltipStyle} />
                <Line type="monotone" dataKey="value" stroke={CHART_COLORS.purple} strokeWidth={2} dot={{ fill: CHART_COLORS.purple, r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : <EmptyChart message="ATV trend needs 2+ periods" />}
        </ChartCard>
      </div>

      <AIObservationsPlaceholder section="Business Performance" />
    </SectionPanel>
  );
}
