/**
 * Maps the 73 MIS metrics to the report sections shown in the Layer 3 UI
 * and Excel export.  Each section corresponds to a tab/panel in the
 * HTML report preview:
 *
 *   cover · dashboard · pl · cf · bs · wc · cost · bpi · statutory ·
 *   forecast · backup
 *
 * A metric can appear in more than one section (e.g. DSO surfaces both in
 * the Working Capital panel and in the Balance Sheet ratios row).
 */

export type SectionId =
  | 'cover'
  | 'dashboard'
  | 'pl'
  | 'cf'
  | 'bs'
  | 'wc'
  | 'cost'
  | 'bpi'
  | 'statutory'
  | 'forecast'
  | 'backup';

export interface SectionDef {
  id: SectionId;
  label: string;
  /** Short blurb under the section heading. */
  blurb?: string;
  /** Metric ids whose results drive this section. */
  metricIds: string[];
}

/** Headline KPI rail at the top of the Dashboard panel. */
export const DASHBOARD_KPI_METRICS = [
  'P1',     // Revenue
  'P5',     // Gross Margin %
  'P6',     // EBITDA
  'P7',     // PAT
  'CF1',    // Cash & Bank
  'WC3',    // Top debtors (proxy for "Debtors outstanding")
];

export const MIS_SECTIONS: SectionDef[] = [
  {
    id: 'cover',
    label: 'Cover',
    blurb: 'Company, period, MIS score summary',
    metricIds: [],
  },
  {
    id: 'dashboard',
    label: 'Executive Dashboard',
    blurb: 'Headline KPIs + trends',
    metricIds: DASHBOARD_KPI_METRICS,
  },
  {
    id: 'pl',
    label: 'P&L Statement',
    blurb: 'Revenue, costs, margins',
    metricIds: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10'],
  },
  {
    id: 'cf',
    label: 'Cash Flow',
    blurb: 'Operating / investing / financing',
    metricIds: ['CF1', 'CF2', 'CF3', 'CF4', 'CF5', 'CF6', 'CF7', 'CF8', 'CF9', 'CF10'],
  },
  {
    id: 'bs',
    label: 'Balance Sheet',
    blurb: 'Health ratios + net worth movement',
    metricIds: ['BS1', 'BS2', 'BS3', 'BS4', 'BS5', 'BS6', 'BS7', 'BS8', 'BS9', 'BS10'],
  },
  {
    id: 'wc',
    label: 'Working Capital',
    blurb: 'Debtors, creditors, inventory cycle',
    metricIds: ['WC1', 'WC2', 'WC3', 'WC4', 'WC5', 'WC6', 'WC7', 'WC8', 'WC9', 'WC10', 'WC11', 'WC12'],
  },
  {
    id: 'cost',
    label: 'Cost Analysis',
    blurb: 'Fixed/variable split, break-even, MoM movement',
    metricIds: ['CA1', 'CA2', 'CA3', 'CA4', 'CA5', 'CA6', 'CA7', 'CA8', 'CA9', 'CA10'],
  },
  {
    id: 'bpi',
    label: 'Business Performance',
    blurb: 'Concentration, ATV, returns, retention',
    metricIds: ['BPI1', 'BPI2', 'BPI3', 'BPI4', 'BPI5', 'BPI6', 'BPI7', 'BPI8', 'BPI9', 'BPI10', 'BPI11', 'BPI12', 'BPI13'],
  },
  {
    id: 'statutory',
    label: 'Statutory & Compliance',
    blurb: 'GST, TDS, PF/ESI, advance tax',
    metricIds: ['SC1', 'SC2', 'SC3', 'SC4', 'SC5', 'SC6', 'SC7', 'SC8'],
  },
  {
    id: 'forecast',
    label: 'Forecast',
    blurb: 'Base / upside / downside scenarios',
    metricIds: [],  // populated dynamically by the forecast engine
  },
  {
    id: 'backup',
    label: 'Backup Working',
    blurb: 'Every metric traceable to its XML source',
    metricIds: [],  // shows all metrics in tabular form
  },
];

export function sectionsForMetric(metricId: string): SectionId[] {
  return MIS_SECTIONS.filter(s => s.metricIds.includes(metricId)).map(s => s.id);
}

export function getSection(id: SectionId): SectionDef | undefined {
  return MIS_SECTIONS.find(s => s.id === id);
}
