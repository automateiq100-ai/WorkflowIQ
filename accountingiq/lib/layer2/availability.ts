/**
 * Data availability resolver.
 *
 * Given an AppState, decide which DataSourceDef entries are satisfied
 * and which metrics are blocked because their inputs are missing.
 *
 * This is the bridge between the static catalogue (data-sources.ts +
 * metric inputs[]) and the live application state.  Pure functions only.
 */

import type { AppState, FileKey } from '../types';
import type { DataSourceDef, DataSourceKind } from './data-sources';
import { ALL_DATA_SOURCES } from './data-sources';
import type { MetricDef, MetricInput, ManualInputs } from './types';
import { ALL_MIS_METRICS } from './mis/metrics';

// ── Status per source ────────────────────────────────────────────────────

export type SourceAvailability = 'available' | 'missing' | 'partial';

export interface SourceStatus {
  source: DataSourceDef;
  status: SourceAvailability;
  /** Optional human note (e.g. filename, "Period: Apr 2025"). */
  note?: string;
}

// ── Single-source check ──────────────────────────────────────────────────

export function checkSource(state: AppState, source: DataSourceDef): SourceStatus {
  switch (source.kind) {
    case 'tally': {
      const file = state.files[source.id as FileKey];
      if (!file) return { source, status: 'missing' };
      if (!file.hasContent) return { source, status: 'missing' };
      return { source, status: 'available', note: file.name || undefined };
    }
    case 'excel': {
      if (source.id === 'budget' && state.misBudget) {
        return { source, status: 'available', note: 'Budget loaded' };
      }
      return { source, status: 'missing' };
    }
    case 'pdf': {
      const doc = state.misDocuments?.[source.id];
      return doc
        ? { source, status: 'available', note: doc.filename }
        : { source, status: 'missing' };
    }
    case 'manual': {
      const inputs = (state.misManualInputs ?? {}) as ManualInputs;
      const key = source.id as keyof ManualInputs;
      const v = inputs[key];
      if (v == null) return { source, status: 'missing' };
      if (typeof v === 'object') {
        // covenants is an object — partial OK if any field filled.
        const filled = Object.values(v as Record<string, unknown>).filter(x => x != null && x !== '');
        if (filled.length === 0) return { source, status: 'missing' };
        if (filled.length < Object.keys(v as Record<string, unknown>).length) return { source, status: 'partial' };
        return { source, status: 'available' };
      }
      return { source, status: 'available' };
    }
    default:
      return { source, status: 'missing' };
  }
}

// ── Batch check ──────────────────────────────────────────────────────────

export function statusesByKind(state: AppState, kind: DataSourceKind): SourceStatus[] {
  return ALL_DATA_SOURCES.filter(s => s.kind === kind).map(s => checkSource(state, s));
}

export function allStatuses(state: AppState): SourceStatus[] {
  return ALL_DATA_SOURCES.map(s => checkSource(state, s));
}

// ── Coverage summary ─────────────────────────────────────────────────────

export interface CoverageSummary {
  total: number;
  available: number;
  partial: number;
  missing: number;
  /** Available + partial as a fraction (0–1). */
  pct: number;
  /** Metric ids that are blocked because at least one required input is missing. */
  blockedMetricIds: string[];
  /** Per-source list of which metrics it would unlock if added. */
  unlockMap: Array<{ source: DataSourceDef; metrics: string[] }>;
}

export function coverage(state: AppState, metrics: MetricDef[] = ALL_MIS_METRICS): CoverageSummary {
  const statuses = allStatuses(state);
  const total = statuses.length;
  const available = statuses.filter(s => s.status === 'available').length;
  const partial = statuses.filter(s => s.status === 'partial').length;
  const missing = total - available - partial;

  // Build set of available source keys (kind + id)
  const availKeys = new Set(
    statuses.filter(s => s.status === 'available' || s.status === 'partial')
      .map(s => `${s.source.kind}:${s.source.id}`)
  );

  const blockedMetricIds: string[] = [];
  for (const m of metrics) {
    if (!m.inputs || m.inputs.length === 0) continue;
    const blocked = m.inputs.some(inp => inp.required && !availKeys.has(`${inp.type}:${inp.id}`));
    if (blocked) blockedMetricIds.push(m.id);
  }

  // Build unlock map: for each missing source, which metrics depend on it.
  const unlockMap: Array<{ source: DataSourceDef; metrics: string[] }> = [];
  for (const s of statuses) {
    if (s.status === 'available') continue;
    const depMetrics = metrics
      .filter(m => m.inputs?.some(inp => inp.type === s.source.kind && inp.id === s.source.id))
      .map(m => m.id);
    if (depMetrics.length > 0 || s.source.unlocks.length > 0) {
      unlockMap.push({ source: s.source, metrics: [...new Set([...depMetrics, ...s.source.unlocks])] });
    }
  }
  unlockMap.sort((a, b) => b.metrics.length - a.metrics.length);

  return {
    total, available, partial, missing,
    pct: total > 0 ? (available + partial * 0.5) / total : 0,
    blockedMetricIds, unlockMap,
  };
}

// ── Per-metric input availability ────────────────────────────────────────

export interface MetricInputStatus {
  input: MetricInput;
  source: DataSourceDef | undefined;
  status: SourceAvailability;
}

export function inputsFor(state: AppState, metric: MetricDef): MetricInputStatus[] {
  if (!metric.inputs) return [];
  return metric.inputs.map(inp => {
    const source = ALL_DATA_SOURCES.find(s => s.kind === inp.type && s.id === inp.id);
    const status = source ? checkSource(state, source).status : 'missing';
    return { input: inp, source, status };
  });
}
