'use client';

/**
 * ── Profile Flag Auto-Detection ──────────────────────────────────────────
 *
 * The Company Profile has 7 boolean flags that drive ~30 of the engine's
 * checks (GST applicability, TDS, PF/ESI, fixed assets, goods vs services,
 * full-FY).  Today the user has to set each one manually before analysis;
 * if they leave them at default many checks return NA inappropriately.
 *
 * This module derives each flag from parsed Tally data so the user gets a
 * suggested baseline they can confirm in one click — consistent with the
 * Master Setup pattern (auto-classify + user confirmation).  Each
 * suggestion carries:
 *
 *   - `value`      — the suggested boolean
 *   - `confidence` — 'high' / 'medium' / 'low' / 'none'
 *   - `reason`     — human-readable evidence ("Found Output GST 9% with
 *                    ₹18k balance"), so users understand what we saw
 *
 * The detector reads from already-parsed structures (parsedData +
 * dbStats), so calling it is cheap — no XML re-parse.
 */

import type { ParsedData, ChunkedStats, CompanyProfile, MasterEntry, ChunkedStats as Stats } from './types';
import { ledgerInCategory, type LedgerCategory } from './tally-groups';
import type { OverrideMap } from './ledger-overrides';

export type FlagConfidence = 'high' | 'medium' | 'low' | 'none';

export interface FlagSuggestion {
  value: boolean;
  confidence: FlagConfidence;
  reason: string;
}

export type ProfileSuggestions = Record<keyof CompanyProfile, FlagSuggestion>;

/**
 * Compute suggestions for every profile flag.  Pass whatever the analysis
 * pipeline produced; missing pieces just degrade individual flags to
 * lower confidence.
 */
export function detectProfileFlags(args: {
  parsedData: Partial<ParsedData>;
  dbStats: ChunkedStats | null;
  masterEntries?: MasterEntry[];
  ledgerOverrides?: OverrideMap;
  /** Period the user actually requested when running analysis (folder
   *  selector or Tally bridge sync).  Used to disambiguate "sparse books"
   *  (full year requested, few months had data) from "partial period
   *  uploaded" (user explicitly chose a narrow slice). */
  requestedPeriod?: { start: string; end: string; type: 'monthly' | 'quarterly' | 'yearly' | 'custom' };
}): ProfileSuggestions {
  const { parsedData: pd, dbStats, masterEntries = [], requestedPeriod } = args;

  // Build masterMap on the fly (cheap — once per call).
  const masterMap = new Map<string, MasterEntry>();
  for (const m of masterEntries) masterMap.set(m.name.toLowerCase().trim(), m);

  const tbLedgers = (pd.tbLedgers as Array<{ name: string; closing: number }> | undefined) ?? [];

  // ── Helper: does any TB ledger fall into one of these categories? ─
  function anyLedgerIn(...cats: LedgerCategory[]): { found: boolean; sample?: string } {
    for (const l of tbLedgers) {
      if (ledgerInCategory(l.name, cats, masterMap, args.ledgerOverrides)) {
        return { found: true, sample: l.name };
      }
    }
    return { found: false };
  }

  // ── Flag 1: gstApplicable ─
  // HIGH if any GST ledger has a non-zero balance OR a GST-classified
  // ledger exists.  Output GST + Input ITC together cover the regulatory
  // GST footprint regardless of regular vs composition scheme.
  const outputGSTAmt = (pd.outputGSTAmt as number | undefined) ?? 0;
  const inputITCAmt  = (pd.inputITCAmt  as number | undefined) ?? 0;
  const gstLedger = anyLedgerIn('duties-output', 'duties-input');
  const gstApplicable: FlagSuggestion = (() => {
    if (outputGSTAmt > 0 || inputITCAmt > 0) {
      return {
        value: true,
        confidence: 'high',
        reason: `Found ${outputGSTAmt > 0 ? `Output GST ₹${Math.round(outputGSTAmt).toLocaleString('en-IN')}` : ''}${outputGSTAmt > 0 && inputITCAmt > 0 ? ' and ' : ''}${inputITCAmt > 0 ? `Input ITC ₹${Math.round(inputITCAmt).toLocaleString('en-IN')}` : ''} in TB`,
      };
    }
    if (gstLedger.found) {
      return { value: true, confidence: 'medium', reason: `GST ledger detected (e.g. "${gstLedger.sample}") but with zero balance` };
    }
    return { value: false, confidence: 'high', reason: 'No GST ledgers found in TB' };
  })();

  // ── Flag 2: gstRegular ─
  // Composition scheme has minimal Output GST (composition tax is a
  // small flat rate posted under different ledger name).  If the company
  // is GST-applicable AND has Output GST > 0 it's almost certainly on
  // the regular scheme.  HIGH only when GST is also high-confidence.
  const gstRegular: FlagSuggestion = (() => {
    if (!gstApplicable.value) {
      return { value: false, confidence: 'high', reason: 'GST not applicable' };
    }
    if (outputGSTAmt > 0) {
      return { value: true, confidence: 'high', reason: 'Output GST present — regular scheme indicator' };
    }
    if (inputITCAmt > 0) {
      return { value: false, confidence: 'medium', reason: 'Only Input ITC seen, no Output GST — possible composition scheme' };
    }
    return { value: true, confidence: 'low', reason: 'GST flagged but no Output/ITC amounts to confirm scheme' };
  })();

  // ── Flag 3: tdsApplicable ─
  const tdsLedgerFound = (pd.tdsLedgerFound as boolean | undefined) ?? false;
  const tdsApplicable: FlagSuggestion = tdsLedgerFound
    ? { value: true, confidence: 'high', reason: 'TDS Payable / TDS-related ledger found in TB' }
    : { value: false, confidence: 'medium', reason: 'No TDS ledger in TB — could be a non-deductor' };

  // ── Flag 4: hasEmployees ─
  // PF/ESI ledger is the strongest signal.  Salary expense in P&L is
  // also a strong signal but less conclusive (many proprietorships pay
  // proprietor "salary" without being statutory employers).
  const pfLedgerFound = (pd.pfLedgerFound as boolean | undefined) ?? false;
  const salarySignal = tbLedgers.some(l => /\b(salary|salaries|wages|payroll)\b/i.test(l.name) && Math.abs(l.closing) > 0);
  const hasEmployees: FlagSuggestion = pfLedgerFound
    ? { value: true, confidence: 'high', reason: 'PF / ESI / Provident Fund ledger present' }
    : salarySignal
      ? { value: true, confidence: 'medium', reason: 'Salary / wages ledger present (no PF/ESI seen — verify if statutorily required)' }
      : { value: false, confidence: 'medium', reason: 'No salary, PF, or ESI ledger in TB' };

  // ── Flag 5: hasFAfilter ─
  const fixedAssets = (pd.fixedAssets as number | undefined) ?? 0;
  const faLedger = anyLedgerIn('fixed-asset');
  const hasFAfilter: FlagSuggestion = (() => {
    if (Math.abs(fixedAssets) > 0) {
      return {
        value: true,
        confidence: 'high',
        reason: `Fixed Assets total ₹${Math.round(Math.abs(fixedAssets)).toLocaleString('en-IN')} in BS`,
      };
    }
    if (faLedger.found) {
      return { value: true, confidence: 'medium', reason: `Fixed-asset ledger detected ("${faLedger.sample}") with zero balance` };
    }
    return { value: false, confidence: 'high', reason: 'No fixed-asset ledgers or balance in BS' };
  })();

  // ── Flag 6: isGoods ─
  // Stock-in-Hand presence (closing stock > 0) indicates a goods business.
  // Pure service companies typically have zero / no stock ledger.
  const closingStock = (pd.closingStock as number | undefined) ?? 0;
  const stockLedger = anyLedgerIn('stock');
  const isGoods: FlagSuggestion = (() => {
    if (Math.abs(closingStock) > 0) {
      return {
        value: true,
        confidence: 'high',
        reason: `Closing stock ₹${Math.round(Math.abs(closingStock)).toLocaleString('en-IN')} on BS`,
      };
    }
    if (stockLedger.found) {
      return { value: true, confidence: 'medium', reason: `Stock ledger detected ("${stockLedger.sample}") with zero balance` };
    }
    return { value: false, confidence: 'high', reason: 'No stock ledger or closing stock balance — likely a services-only business' };
  })();

  // ── Flag 7: fullFY ─
  // The flag captures USER INTENT — "the period I'm analysing covers a
  // complete financial year".  Two signals, in priority order:
  //
  //   (a) The user's explicit period selector (`requestedPeriod`) — if
  //       they asked for ≥11 months, the period IS a full FY regardless
  //       of how many months actually had voucher activity.  This is
  //       the right answer for sparse-books companies.
  //   (b) Distinct months in DayBook — fallback when intent isn't
  //       known (older sessions / direct file uploads without period
  //       metadata).
  const distinctMonths = Object.keys(dbStats?.monthCounts ?? {}).length;
  const fullFY: FlagSuggestion = (() => {
    // (a) Trust user intent when available.
    if (requestedPeriod) {
      const start = new Date(requestedPeriod.start);
      const end = new Date(requestedPeriod.end);
      if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
        const days = (end.getTime() - start.getTime()) / 86400000;
        const monthsRequested = Math.round(days / 30.4);
        if (requestedPeriod.type === 'yearly' || monthsRequested >= 11) {
          // Full-year period was requested.  If actual data is thin,
          // the company is sparse — not a partial-period upload.
          if (distinctMonths === 0) {
            return { value: true, confidence: 'high', reason: 'Yearly period requested (no vouchers parsed yet)' };
          }
          if (distinctMonths < 3) {
            return { value: true, confidence: 'high', reason: `Yearly period requested; only ${distinctMonths} month${distinctMonths === 1 ? '' : 's'} had voucher activity — sparse-books company` };
          }
          return { value: true, confidence: 'high', reason: `Yearly period requested, ${distinctMonths} months of voucher data` };
        }
        if (monthsRequested <= 4) {
          return { value: false, confidence: 'high', reason: `Period requested spans ${monthsRequested} month${monthsRequested === 1 ? '' : 's'} — partial slice` };
        }
        // 5-10 months requested (quarterly etc.) — defer to data.
      }
    }
    // (b) Fallback: infer from data.
    if (!dbStats || distinctMonths === 0) {
      return { value: true, confidence: 'low', reason: 'No DayBook data — defaulting to full FY' };
    }
    if (distinctMonths >= 11) {
      return { value: true, confidence: 'high', reason: `${distinctMonths} months of voucher data — full year` };
    }
    if (distinctMonths >= 9) {
      return { value: true, confidence: 'medium', reason: `${distinctMonths} months of voucher data — near-full year (mid-year migration?)` };
    }
    return { value: false, confidence: 'medium', reason: `Only ${distinctMonths} month${distinctMonths === 1 ? '' : 's'} of voucher data — partial period (or sparse-books — set period explicitly to confirm)` };
  })();

  return {
    gstApplicable,
    gstRegular,
    tdsApplicable,
    hasEmployees,
    hasFAfilter,
    isGoods,
    fullFY,
  };
}

/** True if any suggestion differs from the user's currently-saved profile.
 *  Used to decide whether to surface the "Apply suggestions" CTA. */
export function suggestionsDiffer(suggestions: ProfileSuggestions, current: CompanyProfile): boolean {
  for (const k of Object.keys(suggestions) as Array<keyof CompanyProfile>) {
    if (suggestions[k].value !== current[k]) return true;
  }
  return false;
}
