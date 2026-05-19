'use client';

import type { AnalysisResults, ParsedData, ChunkedStats, AnomalyFlag, Check } from './types';

/**
 * Bug 7 fix: Derive severity deterministically from check's max points.
 * This is the single source of truth for severity across all views.
 *
 * max >= 8  → 'critical'
 * max 5–7   → 'high'
 * max 3–4   → 'medium'
 * max 1–2   → 'low'
 */
export function deriveSeverity(check: Pick<Check, 'max'>): AnomalyFlag['severity'] {
  if (check.max >= 8) return 'critical';
  if (check.max >= 5) return 'high';
  if (check.max >= 3) return 'medium';
  return 'low';
}

export function generateFlags(
  results: AnalysisResults,
  parsedData: Partial<ParsedData>,
  dbStats: ChunkedStats | null,
): AnomalyFlag[] {
  const flags: AnomalyFlag[] = [];
  const { checks } = results;

  // Map check status → severity using deterministic deriveSeverity (Bug 7 fix)
  for (const check of checks) {
    if (check.status === 'fail') {
      flags.push({
        id: check.id,
        severity: deriveSeverity(check),
        // Bug 4: use failLabel when available
        title: check.failLabel ?? check.name,
        detail: check.note || `Check ${check.id} failed.`,
      });
    }
  }

  // Data-driven dbStats findings (zero amount, missing party / vno,
  // out-of-FY, cash > ₹10,000, wrong type, duplicate vouchers) are all
  // surfaced by their corresponding engine checks in engine.ts:
  //   C1 → missing voucher number   C4 → out-of-FY date
  //   C2 → duplicate voucher number C5 → wrong voucher type
  //   C3 → missing party name       C6 → zero / missing amount
  //   G3 → cash > ₹10,000 (269ST)
  // Re-emitting them as `flag-*` data flags here just produced duplicate
  // entries in the Critical Flags panel with the same content under a
  // non-standard ID, so they're all gone.  voucher-filters.ts keeps the
  // `flag-*` handlers for backward compatibility with any persisted state.

  // Structural flags from parsedData.
  // (Suspense / Miscellaneous ledger detection lives in the B1 engine check
  // — see engine.ts.  Surfacing it again here as `flag-suspense` produced
  // a duplicate "Critical" entry with identical content, so it's gone.
  // voucher-filters.ts keeps the 'flag-suspense' drill-down handler for
  // backward compatibility with any persisted state.)

  if (parsedData.salesWrongGroup) {
    flags.push({
      id: 'flag-sales-group',
      severity: 'medium',
      title: 'Sales Ledger Under Wrong Group',
      detail: 'Sales ledger appears to be classified under an incorrect Tally group (should be under "Sales Accounts").',
    });
  }

  if (parsedData.purchaseWrongGroup) {
    flags.push({
      id: 'flag-purch-group',
      severity: 'medium',
      title: 'Purchase Ledger Under Wrong Group',
      detail: 'Purchase ledger appears to be classified under an incorrect Tally group (should be under "Purchase Accounts").',
    });
  }

  if (parsedData.dutiesUnderExpense) {
    flags.push({
      id: 'flag-duties',
      severity: 'medium',
      title: 'GST/Duties Ledger Under Expense',
      detail: 'A Duties & Taxes ledger appears to be classified under Indirect Expenses instead of Duties & Taxes.',
    });
  }

  // Deduplicate by id (check-based flags may overlap with data flags)
  const seen = new Set<string>();
  return flags.filter(f => {
    if (seen.has(f.id)) return false;
    seen.add(f.id);
    return true;
  });
}
