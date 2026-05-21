/**
 * Visual catalogue — declares the preferred viz type for every MIS metric.
 *
 * Single source of truth for "how does this metric show up in the UI?".
 * Panels read this to decide what primitive to render in which slot.
 *
 * Viz types map to primitives in app/views/mis/atoms.tsx:
 *
 *   kpi-tile         → MetricCard
 *   ratio-gauge      → RatioGauge (RAG vs benchmark)
 *   trend-line       → Recharts LineChart / AreaChart
 *   bar-horizontal   → Recharts BarChart layout="vertical" (top-N lists)
 *   bar-vertical     → Recharts BarChart (segment comparison)
 *   aging-bar        → AgingBar (4-bucket horizontal bars)
 *   doughnut         → Recharts PieChart with innerRadius (share-of-whole)
 *   waterfall        → Recharts BarChart with per-bar colours (decomposition)
 *   flow-diagram     → NetWorthFlow / similar 3-box arrow diagram
 *   composed         → Recharts ComposedChart (bar + line overlay)
 *   stat-card        → StatBox / multi-row tinted card
 *   top-list         → TopList (numbered table with bar shading)
 *   scenario-table   → Forecast scenario tabs + table
 *   table-row        → Lives inside a parent table; not a standalone viz
 *   list-output      → Breakdown rendered as table; no chart
 */

export type VizType =
  | 'kpi-tile'
  | 'ratio-gauge'
  | 'trend-line'
  | 'bar-horizontal'
  | 'bar-vertical'
  | 'aging-bar'
  | 'doughnut'
  | 'waterfall'
  | 'flow-diagram'
  | 'composed'
  | 'stat-card'
  | 'top-list'
  | 'scenario-table'
  | 'table-row'
  | 'list-output';

export interface VizSpec {
  /** Primary visualisation for this metric. */
  primary: VizType;
  /** Secondary visualisation when used on a different panel (optional). */
  secondary?: VizType;
  /** Sections this metric appears on (mirrors sections.ts but typed). */
  sections: string[];
}

/**
 * Per-metric viz declarations.  Keyed by metric id.
 *
 * Each metric appears on its "home" section (where the primary viz lives)
 * and may also appear on Dashboard (executive summary) or Backup (audit
 * trail) as a kpi-tile / table-row respectively — those are implicit and
 * not duplicated here.
 */
export const VIZ_CATALOGUE: Record<string, VizSpec> = {
  // ── D1 Profitability ──────────────────────────────────────────────
  P1:  { primary: 'kpi-tile',       secondary: 'trend-line',     sections: ['dashboard', 'pl'] },
  P2:  { primary: 'kpi-tile',                                    sections: ['pl'] },
  P3:  { primary: 'bar-vertical',                                sections: ['pl'] },
  P4:  { primary: 'doughnut',                                    sections: ['pl'] },
  P5:  { primary: 'kpi-tile',       secondary: 'trend-line',     sections: ['dashboard', 'pl'] },
  P6:  { primary: 'kpi-tile',                                    sections: ['dashboard', 'pl'] },
  P7:  { primary: 'kpi-tile',       secondary: 'trend-line',     sections: ['dashboard', 'pl'] },
  P8:  { primary: 'kpi-tile',                                    sections: ['cost'] },
  P9:  { primary: 'trend-line',                                  sections: ['pl'] },
  P10: { primary: 'bar-vertical',                                sections: ['pl'] },

  // ── D2 Cash Flow ─────────────────────────────────────────────────
  CF1: { primary: 'kpi-tile',       secondary: 'flow-diagram',   sections: ['dashboard', 'cf'] },
  CF2: { primary: 'kpi-tile',                                    sections: ['cf'] },
  CF3: { primary: 'bar-vertical',                                sections: ['cf'] },
  CF4: { primary: 'kpi-tile',       secondary: 'composed',       sections: ['cf'] },
  CF5: { primary: 'kpi-tile',                                    sections: ['cf'] },
  CF6: { primary: 'kpi-tile',                                    sections: ['cf'] },
  CF7: { primary: 'kpi-tile',                                    sections: ['cf'] },
  CF8: { primary: 'kpi-tile',                                    sections: ['cf'] },
  CF9: { primary: 'kpi-tile',                                    sections: ['cf'] },
  CF10: { primary: 'stat-card',                                  sections: ['cf'] },

  // ── D3 Working Capital ───────────────────────────────────────────
  WC1: { primary: 'aging-bar',                                   sections: ['wc'] },
  WC2: { primary: 'kpi-tile',                                    sections: ['dashboard', 'wc', 'bs'] },
  WC3: { primary: 'top-list',                                    sections: ['wc'] },
  WC4: { primary: 'kpi-tile',                                    sections: ['wc'] },
  WC5: { primary: 'kpi-tile',                                    sections: ['wc'] },
  WC6: { primary: 'aging-bar',                                   sections: ['wc'] },
  WC7: { primary: 'kpi-tile',                                    sections: ['wc'] },
  WC8: { primary: 'kpi-tile',                                    sections: ['wc'] },
  WC9: { primary: 'top-list',                                    sections: ['wc'] },
  WC10: { primary: 'kpi-tile',                                   sections: ['wc'] },
  WC11: { primary: 'list-output',                                sections: ['wc'] },
  WC12: { primary: 'kpi-tile',      secondary: 'ratio-gauge',    sections: ['wc', 'bs'] },

  // ── D4 Statutory ─────────────────────────────────────────────────
  SC1: { primary: 'stat-card',                                   sections: ['statutory'] },
  SC2: { primary: 'stat-card',                                   sections: ['statutory'] },
  SC3: { primary: 'stat-card',                                   sections: ['statutory'] },
  SC4: { primary: 'stat-card',                                   sections: ['statutory'] },
  SC5: { primary: 'stat-card',                                   sections: ['statutory'] },
  SC6: { primary: 'stat-card',                                   sections: ['statutory'] },
  SC7: { primary: 'stat-card',                                   sections: ['statutory'] },
  SC8: { primary: 'stat-card',                                   sections: ['statutory'] },

  // ── D5 Balance Sheet ─────────────────────────────────────────────
  BS1: { primary: 'ratio-gauge',                                 sections: ['bs'] },
  BS2: { primary: 'ratio-gauge',                                 sections: ['bs'] },
  BS3: { primary: 'ratio-gauge',                                 sections: ['bs'] },
  BS4: { primary: 'ratio-gauge',                                 sections: ['bs'] },
  BS5: { primary: 'ratio-gauge',                                 sections: ['bs'] },
  BS6: { primary: 'flow-diagram',   secondary: 'kpi-tile',       sections: ['bs'] },
  BS7: { primary: 'kpi-tile',                                    sections: ['bs'] },
  BS8: { primary: 'kpi-tile',                                    sections: ['bs'] },
  BS9: { primary: 'kpi-tile',                                    sections: ['bs'] },
  BS10: { primary: 'top-list',                                   sections: ['bs'] },

  // ── D6 Cost Analysis ─────────────────────────────────────────────
  CA1: { primary: 'bar-horizontal',                              sections: ['cost'] },
  CA2: { primary: 'doughnut',                                    sections: ['cost'] },
  CA3: { primary: 'stat-card',                                   sections: ['cost'] },
  CA4: { primary: 'kpi-tile',                                    sections: ['cost'] },
  CA5: { primary: 'bar-horizontal',                              sections: ['cost'] },
  CA6: { primary: 'kpi-tile',                                    sections: ['cost'] },
  CA7: { primary: 'kpi-tile',                                    sections: ['cost'] },
  CA8: { primary: 'bar-vertical',                                sections: ['cost'] },
  CA9: { primary: 'bar-horizontal',                              sections: ['cost'] },
  CA10: { primary: 'stat-card',                                  sections: ['cost'] },

  // ── D7 Business Performance ──────────────────────────────────────
  BPI1: { primary: 'bar-horizontal',   secondary: 'kpi-tile',    sections: ['dashboard', 'bpi'] },
  BPI2: { primary: 'doughnut',                                   sections: ['bpi'] },
  BPI3: { primary: 'doughnut',         secondary: 'kpi-tile',    sections: ['bpi'] },
  BPI4: { primary: 'doughnut',                                   sections: ['bpi'] },
  BPI5: { primary: 'trend-line',       secondary: 'kpi-tile',    sections: ['bpi'] },
  BPI6: { primary: 'kpi-tile',                                   sections: ['bpi'] },
  BPI7: { primary: 'kpi-tile',                                   sections: ['bpi'] },
  BPI8: { primary: 'bar-horizontal',   secondary: 'kpi-tile',    sections: ['bpi'] },
  BPI9: { primary: 'kpi-tile',                                   sections: ['bpi'] },
  BPI10: { primary: 'ratio-gauge',     secondary: 'kpi-tile',    sections: ['bs', 'bpi'] },
  BPI11: { primary: 'stat-card',                                 sections: ['bpi'] },
  BPI12: { primary: 'kpi-tile',                                  sections: ['bpi'] },
  BPI13: { primary: 'kpi-tile',                                  sections: ['bpi'] },
};

/** Lookup helper.  Falls back to `kpi-tile` for any unmapped metric. */
export function vizFor(metricId: string): VizSpec {
  return VIZ_CATALOGUE[metricId] ?? { primary: 'kpi-tile', sections: [] };
}

/** Reverse lookup — metrics whose primary viz is type T. */
export function metricsByViz(type: VizType): string[] {
  return Object.entries(VIZ_CATALOGUE)
    .filter(([, spec]) => spec.primary === type)
    .map(([id]) => id);
}
