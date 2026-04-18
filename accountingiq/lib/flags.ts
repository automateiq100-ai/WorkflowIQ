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

  // Data-driven flags from dbStats
  if (dbStats) {
    const dupCount = Object.values(dbStats.dupVnoMap).reduce((s, v) => s + v, 0);
    if (dupCount > 0) {
      flags.push({
        id: 'flag-dup-vno',
        severity: 'high',
        title: 'Duplicate Voucher Numbers',
        detail: `${dupCount} duplicate voucher number occurrence(s) found in DayBook.`,
        count: dupCount,
      });
    }

    if (dbStats.zeroAmt > 0) {
      flags.push({
        id: 'flag-zero-amt',
        severity: 'medium',
        title: 'Zero-Amount Vouchers',
        detail: `${dbStats.zeroAmt} voucher(s) have zero or missing amounts.`,
        count: dbStats.zeroAmt,
      });
    }

    if (dbStats.missingParty > 0) {
      flags.push({
        id: 'flag-missing-party',
        severity: 'medium',
        title: 'Missing Party Names',
        detail: `${dbStats.missingParty} sales/purchase voucher(s) missing party (customer/vendor) names.`,
        count: dbStats.missingParty,
      });
    }

    if (dbStats.outOfFY > 0) {
      flags.push({
        id: 'flag-out-of-fy',
        severity: 'medium',
        title: 'Vouchers Outside Financial Year',
        detail: `${dbStats.outOfFY} voucher(s) have dates outside the current financial year.`,
        count: dbStats.outOfFY,
      });
    }

    if (dbStats.cashOver10k > 0) {
      flags.push({
        id: 'flag-cash-limit',
        severity: 'high',
        title: 'Cash Transactions Exceeding ₹10,000',
        detail: `${dbStats.cashOver10k} cash transaction(s) exceed ₹10,000. Section 269ST compliance review required.`,
        count: dbStats.cashOver10k,
      });
    }

    if (dbStats.missingVno > 0) {
      flags.push({
        id: 'flag-missing-vno',
        severity: 'medium',
        title: 'Missing Voucher Numbers',
        detail: `${dbStats.missingVno} voucher(s) have no voucher number assigned.`,
        count: dbStats.missingVno,
      });
    }

    if (dbStats.wrongType > 0) {
      flags.push({
        id: 'flag-wrong-type',
        severity: 'low',
        title: 'Unrecognised Voucher Types',
        detail: `${dbStats.wrongType} voucher(s) have unrecognised or non-standard types.`,
        count: dbStats.wrongType,
      });
    }
  }

  // Structural flags from parsedData
  if (parsedData.suspenseCount && parsedData.suspenseCount > 0) {
    flags.push({
      id: 'flag-suspense',
      severity: 'critical',
      title: 'Suspense Accounts with Non-Zero Balances',
      detail: `${parsedData.suspenseCount} suspense / temporary account(s) have non-zero closing balances.`,
      count: parsedData.suspenseCount,
    });
  }

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
