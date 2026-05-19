'use client';

import {
  Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer,
  Tooltip as ReTip, XAxis, YAxis,
} from 'recharts';
import ReportLayout, { useMIS } from '../ReportLayout';
import {
  fmtINR, CHART_COLORS, CHART_GRID, CHART_AXIS,
  tooltipStyle, SectionPanel, MetricCard, ChartCard, EmptyChart,
  AIObservationsPlaceholder, AlertsBanner,
} from '../atoms';
import { DASHBOARD_KPI_METRICS } from '@/lib/layer2/mis/sections';
import { ALL_MIS_METRICS } from '@/lib/layer2/mis/metrics';

export default function MISReportDashboard() {
  return <ReportLayout><DashboardContent /></ReportLayout>;
}

function DashboardContent() {
  const { out, unit, violations, violationsByMetricId, traceToBackup } = useMIS();

  const kpiAccents: Record<string, keyof typeof CHART_COLORS> = {
    P1: 'teal', P5: 'blue', P6: 'purple', P7: 'green', CF1: 'teal', WC3: 'amber',
  };
  const kpiIcons: Record<string, string> = {
    P1: '₹', P5: '%', P6: '◆', P7: '◈', CF1: '◉', WC3: '⊟',
  };

  const revenueTrend = out.byId['P1']?.value?.trend ?? [];
  const marginTrend = out.byId['P5']?.value?.trend ?? [];

  return (
    <SectionPanel title="Executive Dashboard" accent="dashboard" blurb="Headline KPIs and trends for this period.">
      <AlertsBanner violations={violations} />

      <div className="grid grid-cols-3 gap-3">
        {DASHBOARD_KPI_METRICS.map(id => {
          const def = ALL_MIS_METRICS.find(m => m.id === id);
          if (!def) return null;
          return (
            <MetricCard key={id}
              label={def.label}
              result={out.byId[id]}
              unit={unit}
              accent={kpiAccents[id] ?? 'teal'}
              icon={kpiIcons[id]}
              violations={violationsByMetricId[id]}
              metricId={id}
              onTrace={traceToBackup}
            />
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <ChartCard title="Revenue trend">
          {revenueTrend.length >= 2 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={revenueTrend} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART_COLORS.teal} stopOpacity={0.5} />
                    <stop offset="100%" stopColor={CHART_COLORS.teal} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                <XAxis dataKey="periodLabel" tick={{ fontSize: 10, fill: CHART_AXIS }} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={(v: number) => fmtINR(v, unit, false)} tick={{ fontSize: 10, fill: CHART_AXIS }} tickLine={false} axisLine={false} />
                <ReTip formatter={(v) => fmtINR(typeof v === 'number' ? v : 0, unit)} contentStyle={tooltipStyle} />
                <Area type="monotone" dataKey="value" stroke={CHART_COLORS.teal} strokeWidth={2} fill="url(#gRev)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : <EmptyChart message="Trend needs 2+ periods — upload prior months in Data Intake" />}
        </ChartCard>

        <ChartCard title="Gross profit trend">
          {marginTrend.length >= 2 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={marginTrend} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                <XAxis dataKey="periodLabel" tick={{ fontSize: 10, fill: CHART_AXIS }} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={(v: number) => fmtINR(v, unit, false)} tick={{ fontSize: 10, fill: CHART_AXIS }} tickLine={false} axisLine={false} />
                <ReTip formatter={(v) => fmtINR(typeof v === 'number' ? v : 0, unit)} contentStyle={tooltipStyle} />
                <Line type="monotone" dataKey="value" stroke={CHART_COLORS.blue} strokeWidth={2} dot={{ fill: CHART_COLORS.blue, r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : <EmptyChart message="Trend needs 2+ periods" />}
        </ChartCard>
      </div>

      <AIObservationsPlaceholder section="Executive Summary" />
    </SectionPanel>
  );
}
