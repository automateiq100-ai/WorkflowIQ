/**
 * Per-metric input declarations.
 *
 * Kept as a side-table keyed by metric id (rather than inlining inputs[]
 * into every MetricDef in metrics.ts) so the catalogue is easy to scan
 * and easy to amend.  ALL_MIS_METRICS is mutated once at module load to
 * populate `inputs` on each MetricDef from this map.
 *
 * Semantics:
 *   - `required: true`   → compute() will return missing-data without this input
 *   - `required: false`  → input enhances the result but a partial fallback exists
 *
 * The base Tally XMLs (daybook / trialbal / pandl / bsheet / grpsum /
 * master) are implicit prerequisites for any metric since Layer 1 must
 * have run.  We still list them when a metric specifically depends on
 * one — drives the "what unlocks this metric" intake view.
 */

import type { MetricInput } from '../types';
import { ALL_MIS_METRICS } from './metrics';

type Inputs = Record<string, MetricInput[]>;

const METRIC_INPUTS: Inputs = {
  // ── D1 Profitability ─────────────────────────────────────────────────
  P1:  [{ type: 'tally', id: 'pandl', required: true }],
  P2:  [{ type: 'tally', id: 'pandl', required: true }, { type: 'period', id: '2', required: true }],
  P3:  [{ type: 'tally', id: 'pandl', required: true }, { type: 'excel', id: 'budget', required: true }],
  P4:  [{ type: 'tally', id: 'daybook', required: true }],
  P5:  [{ type: 'tally', id: 'pandl', required: true }],
  P6:  [{ type: 'tally', id: 'pandl', required: true }],
  P7:  [{ type: 'tally', id: 'pandl', required: true }, { type: 'tally', id: 'bsheet', required: false, note: 'BS retained-earnings line preferred' }],
  P8:  [{ type: 'tally', id: 'pandl', required: true }, { type: 'tally', id: 'daybook', required: false }],
  P9:  [{ type: 'tally', id: 'pandl', required: true }, { type: 'period', id: '12', required: false }],
  P10: [{ type: 'tally', id: 'pandl', required: true }, { type: 'period', id: '12', required: true, note: 'prior-year same month' }],

  // ── D2 Cash Flow ─────────────────────────────────────────────────────
  CF1:  [{ type: 'tally', id: 'bsheet', required: true }],
  CF2:  [{ type: 'tally', id: 'daybook', required: true }],
  CF3:  [{ type: 'tally', id: 'trialbal', required: true }],
  CF4:  [{ type: 'tally', id: 'pandl', required: true }, { type: 'tally', id: 'bsheet', required: true }, { type: 'period', id: '2', required: false }],
  CF5:  [{ type: 'tally', id: 'bsheet', required: true }, { type: 'period', id: '2', required: false }, { type: 'tally', id: 'cashflow', required: false }],
  CF6:  [{ type: 'tally', id: 'cashflow', required: false }, { type: 'tally', id: 'bsheet', required: true }],
  CF7:  [{ type: 'tally', id: 'pandl', required: true }, { type: 'tally', id: 'bsheet', required: true }],
  CF8:  [{ type: 'tally', id: 'daybook', required: true }, { type: 'tally', id: 'bills', required: false }],
  CF9:  [{ type: 'tally', id: 'trialbal', required: true }],
  CF10: [{ type: 'tally', id: 'trialbal', required: true }, { type: 'tally', id: 'bills', required: false }],

  // ── D3 Working Capital ───────────────────────────────────────────────
  WC1:  [{ type: 'tally', id: 'bills', required: true }],
  WC2:  [{ type: 'tally', id: 'bsheet', required: true }, { type: 'tally', id: 'pandl', required: true }],
  WC3:  [{ type: 'tally', id: 'trialbal', required: true }, { type: 'tally', id: 'daybook', required: true }, { type: 'tally', id: 'bills', required: false }],
  WC4:  [{ type: 'tally', id: 'bills', required: true }],
  WC5:  [{ type: 'tally', id: 'daybook', required: true }],
  WC6:  [{ type: 'tally', id: 'bills', required: true }],
  WC7:  [{ type: 'tally', id: 'bsheet', required: true }, { type: 'tally', id: 'pandl', required: true }],
  WC8:  [{ type: 'tally', id: 'bills', required: true }],
  WC9:  [{ type: 'tally', id: 'trialbal', required: true }, { type: 'tally', id: 'daybook', required: true }, { type: 'tally', id: 'bills', required: false }],
  WC10: [{ type: 'tally', id: 'bsheet', required: true }, { type: 'tally', id: 'pandl', required: true }],
  WC11: [{ type: 'tally', id: 'stock', required: true }],
  WC12: [{ type: 'tally', id: 'bsheet', required: true }, { type: 'tally', id: 'pandl', required: true }],

  // ── D4 Statutory ─────────────────────────────────────────────────────
  SC1: [{ type: 'tally', id: 'trialbal', required: true }],
  SC2: [{ type: 'tally', id: 'trialbal', required: true }],
  SC3: [{ type: 'tally', id: 'trialbal', required: true }],
  SC4: [{ type: 'tally', id: 'trialbal', required: true }, { type: 'tally', id: 'daybook', required: false }],
  SC5: [{ type: 'tally', id: 'daybook', required: true }],
  SC6: [{ type: 'tally', id: 'daybook', required: true }],
  SC7: [{ type: 'tally', id: 'trialbal', required: true }],
  SC8: [{ type: 'tally', id: 'trialbal', required: true }],

  // ── D5 Balance Sheet ─────────────────────────────────────────────────
  BS1:  [{ type: 'tally', id: 'bsheet', required: true }],
  BS2:  [{ type: 'tally', id: 'bsheet', required: true }],
  BS3:  [{ type: 'tally', id: 'bsheet', required: true }],
  BS4:  [{ type: 'tally', id: 'trialbal', required: true }],
  BS5:  [{ type: 'tally', id: 'pandl', required: true }, { type: 'tally', id: 'trialbal', required: true }],
  BS6:  [{ type: 'tally', id: 'trialbal', required: true }, { type: 'period', id: '2', required: true }],
  BS7:  [{ type: 'manual', id: 'drawingPowerLimit', required: true }, { type: 'tally', id: 'trialbal', required: true }],
  BS8:  [{ type: 'tally', id: 'bsheet', required: true }, { type: 'period', id: '2', required: true }],
  BS9:  [{ type: 'tally', id: 'pandl', required: true }],
  BS10: [{ type: 'tally', id: 'trialbal', required: true }],

  // ── D6 Cost Analysis ─────────────────────────────────────────────────
  CA1:  [{ type: 'tally', id: 'pandl', required: true }],
  CA2:  [{ type: 'tally', id: 'pandl', required: true }],
  CA3:  [{ type: 'tally', id: 'pandl', required: true }],
  CA4:  [{ type: 'tally', id: 'pandl', required: true }, { type: 'period', id: '2', required: true }],
  CA5:  [{ type: 'tally', id: 'daybook', required: true }],
  CA6:  [{ type: 'tally', id: 'trialbal', required: true }, { type: 'manual', id: 'headcount', required: true }],
  CA7:  [{ type: 'manual', id: 'productionQty', required: true }, { type: 'tally', id: 'pandl', required: true }],
  CA8:  [{ type: 'tally', id: 'pandl', required: true }, { type: 'excel', id: 'budget', required: true }],
  CA9:  [{ type: 'tally', id: 'pandl', required: true }, { type: 'period', id: '2', required: true }],
  CA10: [{ type: 'tally', id: 'daybook', required: true }],

  // ── D7 BPI ───────────────────────────────────────────────────────────
  BPI1:  [{ type: 'tally', id: 'daybook', required: true }],
  BPI2:  [{ type: 'tally', id: 'daybook', required: true }, { type: 'tally', id: 'stock', required: false }],
  BPI3:  [{ type: 'tally', id: 'daybook', required: true }, { type: 'period', id: '2', required: true }],
  BPI4:  [{ type: 'tally', id: 'daybook', required: true }],
  BPI5:  [{ type: 'tally', id: 'daybook', required: true }, { type: 'tally', id: 'pandl', required: true }],
  BPI6:  [{ type: 'manual', id: 'orderBook', required: true }],
  BPI7:  [{ type: 'tally', id: 'daybook', required: true }],
  BPI8:  [{ type: 'tally', id: 'daybook', required: true }],
  BPI9:  [{ type: 'tally', id: 'bills', required: true }, { type: 'tally', id: 'daybook', required: true }],
  BPI10: [{ type: 'tally', id: 'pandl', required: true }, { type: 'tally', id: 'trialbal', required: true }],
  BPI11: [{ type: 'manual', id: 'covenants', required: true }],
  BPI12: [{ type: 'tally', id: 'daybook', required: true }],
  BPI13: [{ type: 'manual', id: 'contingentLiabilities', required: true }],
};

// ── One-time mutation: populate MetricDef.inputs from the map ─────────────
// Mutating ALL_MIS_METRICS here means every consumer (runner, availability,
// intake view) reads `m.inputs` consistently without each having to import
// the side table.  Side effect at module load is acceptable: the map is
// static, the metrics array is module-scoped, and there's only one writer.
for (const m of ALL_MIS_METRICS) {
  const inputs = METRIC_INPUTS[m.id];
  if (inputs) m.inputs = inputs;
}

export { METRIC_INPUTS };
