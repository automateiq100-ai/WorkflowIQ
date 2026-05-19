'use client';

import ReportLayout, { useMIS } from '../ReportLayout';
import {
  fmtDays, SectionPanel, MetricCard, RatioGauge, AIObservationsPlaceholder,
  FlowDiagram,
} from '../atoms';

export default function MISReportBalanceSheet() {
  return <ReportLayout><BSContent /></ReportLayout>;
}

function BSContent() {
  const { out, unit, violationsByMetricId, traceToBackup } = useMIS();
  const vm = violationsByMetricId;

  // Net-worth flow comes straight from BS6's breakdown — the metric now
  // exposes Opening / PAT / Drawings / Closing rows so the view doesn't
  // have to re-derive anything.
  const bs6bd = out.byId['BS6']?.value?.breakdown ?? [];
  const bdVal = (prefix: string) => bs6bd.find(b => b.label.startsWith(prefix))?.value ?? 0;
  const openingNW = bdVal('Opening');
  const closingNW = bdVal('Closing');
  const pat = bs6bd.length ? bdVal('PAT added') : (out.byId['P7']?.value?.numeric ?? 0);
  const drawings = bdVal('Drawings'); // already negative
  const showFlow = closingNW !== 0 || openingNW !== 0 || pat !== 0;

  return (
    <SectionPanel title="Balance Sheet" accent="bs" blurb="Liquidity, leverage, and capital structure ratios.">
      <div className="grid grid-cols-4 gap-3">
        <RatioGauge label="Current ratio" value={out.byId['BS1']?.value?.numeric} benchmark={1.5} direction="higher-better" metricId="BS1" onTrace={traceToBackup} />
        <RatioGauge label="Quick ratio" value={out.byId['BS2']?.value?.numeric} benchmark={1.0} direction="higher-better" metricId="BS2" onTrace={traceToBackup} />
        <RatioGauge label="Cash ratio" value={out.byId['BS3']?.value?.numeric} benchmark={0.2} direction="higher-better" metricId="BS3" onTrace={traceToBackup} />
        <RatioGauge label="Debt / Equity" value={out.byId['BS4']?.value?.numeric} benchmark={2.0} direction="lower-better" metricId="BS4" onTrace={traceToBackup} />
        <RatioGauge label="Interest cover" value={out.byId['BS5']?.value?.numeric} benchmark={1.5} direction="higher-better" metricId="BS5" onTrace={traceToBackup} />
        <RatioGauge label="DSCR" value={out.byId['BPI10']?.value?.numeric} benchmark={1.25} direction="higher-better" metricId="BPI10" onTrace={traceToBackup} />
        <RatioGauge label="DSO" value={out.byId['WC2']?.value?.numeric} benchmark={45} direction="lower-better" fmt={fmtDays} metricId="WC2" onTrace={traceToBackup} />
        <RatioGauge label="Cash cycle" value={out.byId['WC12']?.value?.numeric} benchmark={50} direction="lower-better" fmt={fmtDays} metricId="WC12" onTrace={traceToBackup} />
      </div>

      {showFlow && (
        <div>
          <div className="text-xs font-semibold mb-2" style={{ color: 'var(--text2)' }}>Net worth movement</div>
          <FlowDiagram
            opening={openingNW}
            openingLabel="Opening NW"
            deltas={[
              { label: 'PAT added', value: pat, tint: 'green' },
              { label: 'Drawings / Div', value: drawings, tint: 'amber' },
            ]}
            closing={closingNW}
            closingLabel="Closing NW"
            unit={unit}
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <MetricCard label="Net worth movement" result={out.byId['BS6']} unit={unit} accent="blue" violations={vm['BS6']} metricId="BS6" onTrace={traceToBackup} />
        <MetricCard label="Fixed asset additions" result={out.byId['BS8']} unit={unit} accent="amber" violations={vm['BS8']} metricId="BS8" onTrace={traceToBackup} />
        <MetricCard label="Depreciation charged" result={out.byId['BS9']} unit={unit} accent="purple" violations={vm['BS9']} metricId="BS9" onTrace={traceToBackup} />
        <MetricCard label="Investments on BS" result={out.byId['BS10']} unit={unit} accent="green" violations={vm['BS10']} metricId="BS10" onTrace={traceToBackup} />
      </div>

      <AIObservationsPlaceholder section="Balance Sheet" />
    </SectionPanel>
  );
}
