'use client';

import type { AnalysisResults, ParsedData, CompanyProfile, Insight } from './types';

function fmt(n: number): string {
  if (n >= 10_000_000) return `₹${(n / 10_000_000).toFixed(2)} Cr`;
  if (n >= 100_000)    return `₹${(n / 100_000).toFixed(2)} L`;
  return `₹${n.toLocaleString('en-IN')}`;
}

export function generateInsights(
  results: AnalysisResults,
  parsedData: Partial<ParsedData>,
  filters: CompanyProfile,
): Insight[] {
  const insights: Insight[] = [];
  const { checks } = results;

  function getCheck(id: string) {
    return checks.find(c => c.id === id);
  }

  // ── Dimension D: Arithmetical accuracy ────────────────────────────────
  const d1 = getCheck('D1');
  if (d1 && (d1.status === 'fail' || d1.status === 'partial')) {
    insights.push({
      id: 'D1-tb',
      urgency: 'critical',
      cat: 'Arithmetical Accuracy',
      finding: 'Trial Balance does not tally — debit ≠ credit.',
      implication: 'Financial statements are unreliable. Any ratio or balance derived from them is suspect.',
      action: 'Identify unbalanced vouchers in Tally and correct the entry. Re-export Trial Balance after rectification.',
      copyText: 'Trial Balance mismatch detected. Debit and credit totals do not agree.',
      checkId: 'D1',
    });
  }

  const d4 = getCheck('D4');
  if (d4 && d4.status === 'fail') {
    insights.push({
      id: 'D4-bs',
      urgency: 'critical',
      cat: 'Arithmetical Accuracy',
      finding: 'Balance Sheet equation broken — Assets ≠ Liabilities + Equity.',
      implication: 'Capital or liability accounts may be misposted. Auditors will flag this immediately.',
      action: 'Reconcile Capital, Reserves, and Loan accounts against year-end figures.',
      copyText: 'Balance Sheet equation is broken. Assets do not equal Liabilities + Equity.',
      checkId: 'D4',
    });
  }

  // ── Dimension B: Ledger structure ─────────────────────────────────────
  const b1 = getCheck('B1');
  if (b1 && b1.status === 'fail') {
    insights.push({
      id: 'B1-suspense',
      urgency: 'critical',
      cat: 'Ledger Structure',
      finding: 'Suspense / temporary accounts have non-zero closing balances.',
      implication: 'Unclassified entries remain in books. Revenue and expense figures are understated or overstated.',
      action: 'Identify and reclassify all suspense entries before finalising accounts.',
      copyText: 'Suspense accounts have non-zero balances — entries need reclassification.',
      checkId: 'B1',
    });
  }

  const b9 = getCheck('B9');
  if (b9 && b9.status === 'fail') {
    insights.push({
      id: 'B9-dup',
      urgency: 'high',
      cat: 'Ledger Structure',
      finding: 'Duplicate ledger names detected (similar-looking accounts).',
      implication: 'Transactions may be split across duplicate ledgers, causing incorrect balances.',
      action: 'Merge or delete duplicate ledgers in Tally and re-post affected vouchers.',
      copyText: 'Duplicate ledger names found — possible split balances.',
      checkId: 'B9',
    });
  }

  // ── Dimension C: Voucher integrity ────────────────────────────────────
  const c1 = getCheck('C1');
  if (c1 && (c1.status === 'fail' || c1.status === 'partial')) {
    insights.push({
      id: 'C1-vno',
      urgency: 'high',
      cat: 'Voucher Integrity',
      finding: 'Vouchers with missing voucher numbers detected.',
      implication: 'Incomplete voucher trail makes audit sampling difficult and may indicate skipped entries.',
      action: 'Enable auto-voucher numbering in Tally or manually assign numbers to all vouchers.',
      copyText: 'Missing voucher numbers found — incomplete voucher trail.',
      checkId: 'C1',
    });
  }

  const c2 = getCheck('C2');
  if (c2 && c2.status === 'fail') {
    insights.push({
      id: 'C2-dup',
      urgency: 'high',
      cat: 'Voucher Integrity',
      finding: 'Duplicate voucher numbers exist — same number used more than once.',
      implication: 'Possible double-entry of transactions. Overstated expenses or revenues.',
      action: 'Review and delete or renumber duplicate vouchers. Check if amounts match.',
      copyText: 'Duplicate voucher numbers detected — potential double posting.',
      checkId: 'C2',
    });
  }

  const c6 = getCheck('C6');
  if (c6 && (c6.status === 'fail' || c6.status === 'partial')) {
    insights.push({
      id: 'C6-party',
      urgency: 'medium',
      cat: 'Voucher Integrity',
      finding: 'Sales/purchase vouchers have missing party names.',
      implication: 'Cannot reconcile outstanding receivables or payables. Affects bills tracking.',
      action: 'Update affected vouchers with correct party (ledger) names.',
      copyText: 'Sales/purchase vouchers missing party names — bills tracking affected.',
      checkId: 'C6',
    });
  }

  // ── Dimension F: Recording discipline ────────────────────────────────
  const f3 = getCheck('F3');
  if (f3 && (f3.status === 'fail' || f3.status === 'partial')) {
    insights.push({
      id: 'F3-narr',
      urgency: 'medium',
      cat: 'Recording Discipline',
      finding: 'Narration coverage is below threshold — many vouchers lack descriptions.',
      implication: 'Difficult to understand transaction intent during audit or review.',
      action: 'Add meaningful narrations to all significant vouchers. Aim for 70%+ coverage.',
      copyText: 'Low narration coverage — many vouchers lack descriptions.',
      checkId: 'F3',
    });
  }

  const f4 = getCheck('F4');
  if (f4 && f4.status === 'fail') {
    insights.push({
      id: 'F4-hv',
      urgency: 'high',
      cat: 'Recording Discipline',
      finding: `High-value entries (>₹1 lakh) are missing narrations.`,
      implication: 'Significant transactions without explanation — audit risk for management entries.',
      action: 'Add detailed narrations to all entries above ₹1,00,000.',
      copyText: 'High-value vouchers (>₹1L) missing narrations.',
      checkId: 'F4',
    });
  }

  const f1 = getCheck('F1');
  if (f1 && f1.status === 'fail') {
    insights.push({
      id: 'F1-gaps',
      urgency: 'medium',
      cat: 'Recording Discipline',
      finding: 'Significant gaps (>7 days) in voucher dates detected.',
      implication: 'Transactions may have been recorded in bulk, suggesting delayed bookkeeping.',
      action: 'Review missing date ranges and post any pending entries for those periods.',
      copyText: 'Date gaps >7 days found in DayBook — possible delayed data entry.',
      checkId: 'F1',
    });
  }

  // ── Dimension G: Consistency ─────────────────────────────────────────
  const g2 = getCheck('G2');
  if (g2 && g2.status === 'fail') {
    insights.push({
      id: 'G2-cash',
      urgency: 'high',
      cat: 'Compliance — Section 269ST',
      finding: 'Cash receipts/payments exceeding ₹10,000 detected.',
      implication: 'Section 269ST of Income Tax Act prohibits cash transactions ≥ ₹2 lakh in one day. Amounts over ₹10k are flagged for review.',
      action: 'Review flagged cash vouchers. Transactions over ₹2 lakh in cash are illegal and attract penalty equal to the amount.',
      copyText: 'Cash transactions exceeding ₹10,000 detected — Section 269ST review required.',
      checkId: 'G2',
    });
  }

  // ── Dimension E: Statutory ────────────────────────────────────────────
  if (filters.gstApplicable) {
    const e1 = getCheck('E1');
    if (e1 && (e1.status === 'fail' || e1.status === 'missing')) {
      insights.push({
        id: 'E1-gst',
        urgency: 'high',
        cat: 'Statutory Compliance',
        finding: 'GST output/input ledgers not found or unbalanced.',
        implication: 'GST liability may be understated. Return filing data will not match books.',
        action: 'Ensure Output GST and Input ITC ledgers exist under the Duties & Taxes group.',
        copyText: 'GST ledgers missing or unbalanced — return filing data may not match books.',
        checkId: 'E1',
      });
    }
  }

  if (filters.tdsApplicable) {
    const e5 = getCheck('E5');
    if (e5 && (e5.status === 'fail' || e5.status === 'missing')) {
      insights.push({
        id: 'E5-tds',
        urgency: 'high',
        cat: 'Statutory Compliance',
        finding: 'TDS payable ledger not found.',
        implication: 'TDS deducted from vendors/salary may not be tracked. Risk of under-reporting to TRACES.',
        action: 'Create TDS Payable ledger under Current Liabilities and post all TDS deductions.',
        copyText: 'TDS payable ledger not found — TDS compliance tracking is missing.',
        checkId: 'E5',
      });
    }
  }

  if (filters.hasEmployees) {
    const e6 = getCheck('E6');
    if (e6 && (e6.status === 'fail' || e6.status === 'missing')) {
      insights.push({
        id: 'E6-pf',
        urgency: 'medium',
        cat: 'Statutory Compliance',
        finding: 'PF/ESI payable ledger not found.',
        implication: 'Statutory contributions may not be recorded. Risk during PF/ESIC audit.',
        action: 'Create PF Payable and ESI Payable ledgers and post monthly contributions.',
        copyText: 'PF/ESI payable ledgers not found — employee statutory compliance at risk.',
        checkId: 'E6',
      });
    }
  }

  // ── Positive insights ─────────────────────────────────────────────────
  const allPassed = checks.filter(c => c.dim === 'D' && c.status === 'pass').length;
  if (allPassed >= 4) {
    insights.push({
      id: 'pos-arith',
      urgency: 'positive',
      cat: 'Arithmetical Accuracy',
      finding: 'All arithmetic checks passed — books balance correctly.',
      implication: 'Trial Balance tallies and Balance Sheet equation holds.',
      action: 'No action required.',
      copyText: 'Arithmetic checks passed — books are arithmetically accurate.',
    });
  }

  if (filters.gstApplicable) {
    const e1p = getCheck('E1');
    if (e1p && e1p.status === 'pass') {
      insights.push({
        id: 'pos-gst',
        urgency: 'positive',
        cat: 'Statutory Compliance',
        finding: 'GST ledgers are present and output/input amounts are within threshold.',
        implication: 'GST books appear consistent.',
        action: 'Verify GSTR-1 and GSTR-3B match these figures before filing.',
        copyText: 'GST ledgers present and balanced — compliant.',
      });
    }
  }

  return insights;
}
