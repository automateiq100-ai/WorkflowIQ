'use client';

import { useState, useEffect, useCallback } from 'react';
import { useApp } from '@/lib/state';
import type { Rule, DimKey } from '@/lib/types';
import { DIM_LABELS } from '@/lib/constants';

const STORAGE_KEY = 'aiq_rules_v2';

// Built-in rules — one per engine check (all 60 checks across 8 dimensions)
const BUILTIN_RULES: Rule[] = [
  // ── A: Data Completeness ──
  { id: 'A1', name: 'DayBook exported and readable',         description: 'DayBook XML must be uploaded and parseable — gates 40+ voucher-level checks', dimension: 'A', severity: 'critical', enabled: true, builtIn: true, checkId: 'A1', condition: 'hasDaybook === false', remediation: 'Gateway of Tally → Display More Reports → Day Book → set date range → Alt+E → XML format → export.' },
  { id: 'A2', name: 'Trial Balance present and parses',       description: 'Trial Balance XML must be present — gates all ledger-structure checks', dimension: 'A', severity: 'critical', enabled: true, builtIn: true, checkId: 'A2', condition: 'hasTB === false', remediation: 'Gateway of Tally → Display More Reports → Account Books → Trial Balance → Alt+E → XML.' },
  { id: 'A3', name: 'P&L statement present and parses',       description: 'Profit & Loss XML must be present — gates revenue, expense, and net profit checks', dimension: 'A', severity: 'critical', enabled: true, builtIn: true, checkId: 'A3', condition: 'hasPL === false', remediation: 'Gateway of Tally → Display More Reports → Financial Statements → Profit & Loss A/c → Alt+E → XML.' },
  { id: 'A4', name: 'Balance Sheet present and parses',        description: 'Balance Sheet XML must be present — gates BS-side checks and H4 reconciliation', dimension: 'A', severity: 'critical', enabled: true, builtIn: true, checkId: 'A4', condition: 'hasBS === false', remediation: 'Gateway of Tally → Display More Reports → Financial Statements → Balance Sheet → Alt+E → XML.' },
  { id: 'A5', name: 'Group Summary present',                   description: 'Group Summary XML must be present — gates ledger classification checks B4, B5, B10', dimension: 'A', severity: 'high', enabled: true, builtIn: true, checkId: 'A5', condition: 'hasGrp === false', remediation: 'Gateway of Tally → Display More Reports → Account Books → Group Summary → Alt+E → XML.' },
  { id: 'A6', name: 'Data covers stated financial year',       description: 'All DayBook entries should fall within the selected financial year', dimension: 'A', severity: 'medium', enabled: true, builtIn: true, checkId: 'A6', condition: 'outOfFY > 0', remediation: 'Check date entries: Gateway of Tally → Day Book → filter by date. Correct vouchers with wrong financial year dates.' },
  { id: 'A7', name: 'Opening balances entered in Tally',       description: 'Opening balances must be entered for the first year of data entry', dimension: 'A', severity: 'medium', enabled: true, builtIn: true, checkId: 'A7', condition: 'hasOpeningBal === false', remediation: 'Gateway of Tally → Chart of Accounts → Ledgers → Alter each ledger → enter opening balance. Or use F11 → Show Opening Balances.' },

  // ── B: Ledger Structure ──
  { id: 'B1', name: 'No suspense or miscellaneous ledgers',    description: 'No Suspense/Miscellaneous ledgers should carry non-zero closing balance', dimension: 'B', severity: 'critical', enabled: true, builtIn: true, checkId: 'B1', condition: 'suspenseCount > 0', remediation: 'Gateway of Tally → Chart of Accounts → Ledgers → Alter → reclassify suspense ledger balance to the correct group (e.g. Sundry Creditors, Capital, or Direct Expenses).' },
  { id: 'B2', name: 'No duplicate or near-duplicate ledgers',  description: 'Near-duplicate ledger names cause double-counting and inflate balances', dimension: 'B', severity: 'high', enabled: true, builtIn: true, checkId: 'B2', condition: 'dupPairs > 0', remediation: 'Gateway of Tally → Chart of Accounts → Ledgers → Alter → merge or delete duplicate. Use the Display Name to distinguish if both must exist.' },
  { id: 'B3', name: 'Capital / owner equity ledger exists',    description: 'A Capital Account ledger is mandatory for proprietorships and partnerships', dimension: 'B', severity: 'critical', enabled: true, builtIn: true, checkId: 'B3', condition: 'capFound === false', remediation: 'Gateway of Tally → Chart of Accounts → Ledgers → Create → name "Capital Account" → group "Capital Account" → enter opening balance.' },
  { id: 'B4', name: 'Sales ledgers under Sales Accounts group', description: 'All sales ledgers must be grouped under Sales Accounts — not Direct Income or P&L', dimension: 'B', severity: 'high', enabled: true, builtIn: true, checkId: 'B4', condition: 'salesWrongGroup === true', remediation: 'Gateway of Tally → Chart of Accounts → Ledgers → Alter → change group from current incorrect group to "Sales Accounts".' },
  { id: 'B5', name: 'Purchase ledgers under Purchase Accounts', description: 'All purchase ledgers must be grouped under Purchase Accounts', dimension: 'B', severity: 'high', enabled: true, builtIn: true, checkId: 'B5', condition: 'purchaseWrongGroup === true', remediation: 'Gateway of Tally → Chart of Accounts → Ledgers → Alter → change group to "Purchase Accounts".' },
  { id: 'B6', name: 'Bank ledgers under Bank Accounts group',  description: 'At least one ledger must be under Bank Accounts for bank reconciliation to work', dimension: 'B', severity: 'high', enabled: true, builtIn: true, checkId: 'B6', condition: 'bankFound === false', remediation: 'Gateway of Tally → Chart of Accounts → Ledgers → Create or Alter → group "Bank Accounts" → enable bank reconciliation.' },
  { id: 'B7', name: 'Cash ledger under Cash-in-Hand group',    description: 'At least one Cash-in-Hand ledger must exist for cash-flow and Section 40A(3) cash-payment checks', dimension: 'B', severity: 'high', enabled: true, builtIn: true, checkId: 'B7', condition: 'cashFound === false', remediation: 'Gateway of Tally → Chart of Accounts → Ledgers → Create → name "Cash" → group "Cash-in-Hand".' },
  { id: 'B8', name: 'Debtors under Sundry Debtors group',     description: 'Receivables must be grouped under Sundry Debtors for correct Current Asset calculation', dimension: 'B', severity: 'high', enabled: true, builtIn: true, checkId: 'B8', condition: 'debtorFound === false', remediation: 'Gateway of Tally → Chart of Accounts → Ledgers → Create or Alter → group "Sundry Debtors".' },
  { id: 'B9', name: 'Creditors under Sundry Creditors group', description: 'Payables must be grouped under Sundry Creditors for correct Current Liability calculation', dimension: 'B', severity: 'high', enabled: true, builtIn: true, checkId: 'B9', condition: 'creditorFound === false', remediation: 'Gateway of Tally → Chart of Accounts → Ledgers → Create or Alter → group "Sundry Creditors".' },
  { id: 'B10', name: 'Duties & Taxes not under Expenses',     description: 'GST/TDS/Statutory ledgers misclassified under Expenses inflate reported costs and break E-dimension checks', dimension: 'B', severity: 'high', enabled: true, builtIn: true, checkId: 'B10', condition: 'dutiesUnderExpense === true', remediation: 'Gateway of Tally → Chart of Accounts → Ledgers → Alter → change group from "Indirect Expenses" to "Duties & Taxes".' },

  // ── C: Voucher Integrity ──
  { id: 'C1', name: 'All vouchers have voucher numbers',       description: 'Missing voucher numbers make audit trails untraceable and break sequential numbering', dimension: 'C', severity: 'high', enabled: true, builtIn: true, checkId: 'C1', condition: 'missingVno > 0', remediation: 'Gateway of Tally → Chart of Accounts → Voucher Types → Alter each type → set Method of Numbering to "Automatic". Then renumber affected vouchers.' },
  { id: 'C2', name: 'No duplicate voucher numbers',           description: 'Duplicate voucher numbers indicate manual overrides or data corruption', dimension: 'C', severity: 'critical', enabled: true, builtIn: true, checkId: 'C2', condition: 'dupVouchers > 0', remediation: 'Gateway of Tally → Vouchers → identify duplicates → Gateway of Tally → Utilities → Renumber Vouchers to assign unique sequential numbers.' },
  { id: 'C3', name: 'All trade vouchers have party name',     description: 'Sales, Purchase, Receipt, and Payment vouchers must have a party (ledger) assigned', dimension: 'C', severity: 'high', enabled: true, builtIn: true, checkId: 'C3', condition: 'missingParty > 0', remediation: 'Day Book → filter by voucher type → open each voucher missing party → add the correct party ledger in the party name field → save.' },
  { id: 'C4', name: 'All entry dates within financial year', description: 'Vouchers dated outside the financial year get posted to wrong periods', dimension: 'C', severity: 'critical', enabled: true, builtIn: true, checkId: 'C4', condition: 'outOfFY > 0', remediation: 'Day Book → look for entries outside Apr–Mar range → alter each voucher and correct the date to the appropriate financial year date.' },
  { id: 'C5', name: 'No wrong-type postings',                description: 'Voucher type must match the transaction — e.g. sales must use Sales voucher, not Journal', dimension: 'C', severity: 'high', enabled: true, builtIn: true, checkId: 'C5', condition: 'wrongType > 0', remediation: 'Day Book → identify wrongly typed vouchers → delete and re-enter with correct voucher type (Sales, Purchase, Payment, Receipt, etc.).' },
  { id: 'C6', name: 'Zero-amount vouchers below 2%',         description: 'Excessive zero-amount vouchers indicate data quality issues or incomplete entries', dimension: 'C', severity: 'medium', enabled: true, builtIn: true, checkId: 'C6', condition: 'zeroPct >= 0.02', remediation: 'Day Book → filter by amount = 0 → either delete invalid zero-value vouchers or complete the partial entries with correct amounts.' },
  { id: 'C7', name: 'No voucher references absent from ledger', description: 'DayBook and Trial Balance must both be present for cross-reference verification', dimension: 'C', severity: 'medium', enabled: true, builtIn: true, checkId: 'C7', condition: 'hasDaybook === false || hasTB === false', remediation: 'Ensure both DayBook and Trial Balance are exported and uploaded for complete cross-reference checks.' },

  // ── D: Arithmetical Accuracy ──
  // D1 (Trial Balance Dr = Cr) removed — Tally enforces this at voucher-save
  // time, so the check was structurally always-pass.
  { id: 'D2', name: 'P&L net profit = BS Profit & Loss A/c', description: 'Net Profit in the P&L must match the Profit & Loss A/c balance in the Balance Sheet', dimension: 'D', severity: 'critical', enabled: true, builtIn: true, checkId: 'D2', condition: 'plNetProfit !== bsNetProfit', remediation: 'Compare P&L → Net Profit vs Balance Sheet → Profit & Loss A/c. Common cause: closing entries not posted. Gateway of Tally → post closing transfer entry.' },
  { id: 'D3', name: 'Balance Sheet balances (Assets = Liab + Cap)', description: 'Balance Sheet equation must hold — Assets = Liabilities + Capital', dimension: 'D', severity: 'critical', enabled: true, builtIn: true, checkId: 'D3', condition: 'bsImbalance === true', remediation: 'Display Financial Statements → Balance Sheet → verify totals. Investigate and correct any unbalanced vouchers causing the discrepancy.' },
  { id: 'D4', name: 'TB total ≈ BS total assets',             description: 'Trial Balance aggregate should approximately match Balance Sheet total assets', dimension: 'D', severity: 'medium', enabled: true, builtIn: true, checkId: 'D4', condition: 'tbTotalMismatch === true', remediation: 'Compare Trial Balance total with Balance Sheet total. Investigate adjusting/closing entries that may not be reflected in both reports.' },
  { id: 'D5', name: 'Closing stock: P&L = BS figure',         description: 'Closing Stock in P&L must equal the Closing Stock value in Balance Sheet', dimension: 'D', severity: 'high', enabled: true, builtIn: true, checkId: 'D5', condition: 'closingStock === 0 && isGoods', remediation: 'Gateway of Tally → F11 → Inventory Features → enable. Then post closing stock entry: Stock in Hand Dr → Purchase/Trading A/c Cr at year-end.' },

  // ── E: Statutory Accuracy ──
  { id: 'E1', name: 'Output GST ledger exists',               description: 'Output GST (CGST/SGST/IGST Output) ledger must exist for GST-registered entities', dimension: 'E', severity: 'high', enabled: true, builtIn: true, checkId: 'E1', condition: 'gstApplicable && outputGSTAmt === 0', remediation: 'Gateway of Tally → Chart of Accounts → Ledgers → Create → name "CGST Output"/"SGST Output"/"IGST Output" → group "Duties & Taxes" → set GST details.' },
  { id: 'E2a', name: 'All sales ledgers have GST rate specified', description: 'Each sales ledger must have a GST rate so tax is computed correctly on every invoice', dimension: 'E', severity: 'medium', enabled: true, builtIn: true, checkId: 'E2a', condition: 'salesLedgersNoRate > 0', remediation: 'Gateway of Tally → Chart of Accounts → Ledgers → Alter each sales ledger → set GST Applicability and HSN/SAC code.' },
  { id: 'E2b', name: 'Output GST amount matches computed amount', description: 'Computed GST on sales should match the Output GST ledger balance — variance >15% is a red flag', dimension: 'E', severity: 'high', enabled: true, builtIn: true, checkId: 'E2b', condition: 'gstDiffPct >= 0.05', remediation: 'Cross-check GSTR-1 with Output GST ledger. Look for: invoices without GST, wrong rate applied, or exempt sales included in GST total.' },
  { id: 'E3', name: 'Input ITC ledgers exist',                description: 'Input Tax Credit ledgers (CGST Input, SGST Input, IGST Input) must exist for GST entities', dimension: 'E', severity: 'high', enabled: true, builtIn: true, checkId: 'E3', condition: 'gstApplicable && inputITCAmt === 0', remediation: 'Gateway of Tally → Chart of Accounts → Ledgers → Create → "CGST Input"/"SGST Input"/"IGST Input" → group "Duties & Taxes".' },
  { id: 'E4', name: 'Input ITC does not exceed Output GST',   description: 'Input ITC exceeding Output GST is a statutory red flag and may indicate ITC fraud or incorrect posting', dimension: 'E', severity: 'critical', enabled: true, builtIn: true, checkId: 'E4', condition: 'inputITCAmt > outputGSTAmt', remediation: 'Compare GSTR-2B (ITC available) with ITC claimed. Excess ITC must be reversed. Consult GST Reconciliation → reconcile mismatches.' },
  { id: 'E5', name: 'TDS Payable ledger exists',              description: 'TDS Payable ledger under Duties & Taxes must exist for TDS-deductors', dimension: 'E', severity: 'high', enabled: true, builtIn: true, checkId: 'E5', condition: 'tdsApplicable && !tdsLedgerFound', remediation: 'Gateway of Tally → Chart of Accounts → Ledgers → Create → name "TDS Payable" → group "Duties & Taxes" → configure TDS details.' },
  { id: 'E6', name: 'TDS amount reasonable vs payments',      description: 'TDS deducted should be proportionate to payments made to vendors under TDS', dimension: 'E', severity: 'medium', enabled: true, builtIn: true, checkId: 'E6', condition: 'tdsMismatch === true', remediation: 'Review payment vouchers to covered parties and verify TDS deduction at applicable rates. Check Form 26Q filed vs TDS ledger balance.' },
  { id: 'E7', name: 'PF / ESI Payable ledger exists',         description: 'PF and ESI Payable ledgers must exist for entities with employees', dimension: 'E', severity: 'high', enabled: true, builtIn: true, checkId: 'E7', condition: 'hasEmployees && !pfLedgerFound', remediation: 'Gateway of Tally → Chart of Accounts → Ledgers → Create → "PF Payable" and "ESI Payable" → group "Duties & Taxes".' },
  { id: 'E8', name: 'Depreciation entry exists in P&L',       description: 'Entities with fixed assets must have a depreciation entry in P&L (Schedule II compliance)', dimension: 'E', severity: 'high', enabled: true, builtIn: true, checkId: 'E8', condition: 'hasFAfilter && !depFound', remediation: 'Gateway of Tally → Vouchers → select last day of FY → create Journal voucher: Depreciation A/c Dr → Fixed Assets / Accumulated Depreciation Cr.' },
  { id: 'E9', name: 'Depreciation amount reasonable',         description: 'Depreciation must not exceed the net fixed asset value — if it does, there is a classification error', dimension: 'E', severity: 'medium', enabled: true, builtIn: true, checkId: 'E9', condition: 'depAmt >= fixedAssets', remediation: 'Verify fixed asset register. If depreciation exceeds net block, check if assets are already fully depreciated or if accumulated depreciation is counted twice.' },
  { id: 'E10', name: 'Closing stock in Balance Sheet',         description: 'Entities dealing in goods must show closing stock as a Current Asset in the Balance Sheet', dimension: 'E', severity: 'high', enabled: true, builtIn: true, checkId: 'E10', condition: 'isGoods && closingStock === 0', remediation: 'Gateway of Tally → Inventory → enable inventory in F11. Post closing stock journal entry at year-end. Verify Stock Summary is exported and matches BS.' },
  { id: 'E11', name: 'Stock equation: Op + Pur − COGS ≈ Closing', description: 'Opening Stock + Purchases − Cost of Goods Sold must approximately equal Closing Stock', dimension: 'E', severity: 'medium', enabled: true, builtIn: true, checkId: 'E11', condition: 'stockEquationFailed === true', remediation: 'Reconcile: Opening Stock + Purchase Ledger total − COGS (Direct Expenses) = Closing Stock. Identify and correct the mismatch in stock or purchase ledgers.' },
  { id: 'E12', name: 'Stock movement entries exist',           description: 'Goods businesses must have stock movement journal entries or purchase/sales entries in DayBook', dimension: 'E', severity: 'medium', enabled: true, builtIn: true, checkId: 'E12', condition: 'isGoods && !hasDaybook', remediation: 'Ensure DayBook is uploaded. Verify stock movement vouchers (Delivery Note, Receipt Note, Stock Journal) are recorded in Tally.' },

  // ── F: Recording Discipline ──
  { id: 'F1', name: 'No gaps > 30 days in active months',    description: 'Gaps over 30 consecutive days with no entries suggest unposted vouchers or data export issues', dimension: 'F', severity: 'high', enabled: true, builtIn: true, checkId: 'F1', condition: 'maxGapDays > 30', remediation: 'Review Day Book for the gap period. If entries exist in Tally but not in the export, re-export with correct date range. If entries are genuinely missing, post them.' },
  { id: 'F2', name: 'Books current — entries up to FY end',  description: 'For a full FY, entries should be present up to 31 March — stale books indicate incomplete posting', dimension: 'F', severity: 'medium', enabled: true, builtIn: true, checkId: 'F2', condition: 'fullFY && latestEntryBeforeMarch', remediation: 'Post all pending entries up to 31 March: accruals, depreciation, closing stock, bank charges, GST payment entries. Then re-export DayBook.' },
  { id: 'F3', name: 'Narration on > 70% of vouchers',        description: 'At least 90% of vouchers should have narration for audit trail quality; 70–90% is partial', dimension: 'F', severity: 'medium', enabled: true, builtIn: true, checkId: 'F3', condition: 'narratedPct < 0.70', remediation: 'Day Book → filter vouchers without narration → add relevant narration to each. Enforce a policy: no voucher is saved without a narration.' },
  { id: 'F4', name: 'High-value entries (> ₹1L) have narration', description: 'All vouchers above ₹1 Lakh must have narration explaining the business purpose', dimension: 'F', severity: 'high', enabled: true, builtIn: true, checkId: 'F4', condition: 'highValueNarrated < highValueCount', remediation: 'Day Book → filter amount > 100000 → open each voucher without narration → add business context narration (e.g. party name, invoice number, purpose).' },
  { id: 'F5', name: 'Journal vouchers < 25% of total',        description: 'Excessive journal vouchers suggest transactions being routed through journals instead of proper voucher types', dimension: 'F', severity: 'medium', enabled: true, builtIn: true, checkId: 'F5', condition: 'journalPct >= 0.25', remediation: 'Identify journal vouchers that should be Sales/Purchase/Payment/Receipt. Convert them to correct voucher types to improve audit trail quality.' },
  { id: 'F6', name: 'Entries spread — not bunched at year-end', description: 'If peak month volume is 3× or more the monthly average, entries are likely being bunched at year-end', dimension: 'F', severity: 'medium', enabled: true, builtIn: true, checkId: 'F6', condition: 'monthMax/monthAvg >= 3', remediation: 'Post entries on a real-time basis during the year. If backlog is unavoidable, consider monthly closing discipline. Spread adjustment entries across months.' },

  // ── G: Consistency ──
  { id: 'G1', name: 'Same party not split across multiple ledgers', description: 'One party (customer/vendor) should not appear under multiple different ledger names', dimension: 'G', severity: 'medium', enabled: true, builtIn: true, checkId: 'G1', condition: 'splitPartyFound === true', remediation: 'Gateway of Tally → Chart of Accounts → Ledgers → identify duplicates → merge ledger balances → delete the duplicate using the Display Name field.' },
  { id: 'G2', name: 'Same expense not in multiple ledger groups', description: 'Similar expense ledgers should not appear under different groups — creates inconsistent reporting', dimension: 'G', severity: 'medium', enabled: true, builtIn: true, checkId: 'G2', condition: 'dupPairs > 0', remediation: 'Review near-duplicate expense ledger pairs. Standardise grouping — all similar expenses under the same parent group (e.g. all office expenses under Indirect Expenses).' },
  { id: 'G3', name: 'Cash not used for entries > ₹10,000',   description: 'Section 40A(3) disallows business expenditure paid in cash above ₹10,000 in a day to a single person (₹35,000 for transporters) — the expense is added back to taxable income', dimension: 'G', severity: 'critical', enabled: true, builtIn: true, checkId: 'G3', condition: 'cashOver10k > 0', remediation: 'Day Book → filter Cash vouchers > ₹10,000 → route the payment through bank to retain the deduction, or amend the voucher if a bank payment was actually made.' },
  { id: 'G4', name: 'Round-number entries below 20% of total', description: 'More than 20% round-number entries may indicate estimated bookkeeping rather than actual transaction recording', dimension: 'G', severity: 'info', enabled: true, builtIn: true, checkId: 'G4', condition: 'roundPct >= 0.20', remediation: 'Identify round-number entries in Day Book. Verify each has a corresponding invoice/bill. Replace estimated entries with actual amounts from supporting documents.' },
  { id: 'G5', name: 'No cash receipts ≥ ₹2 lakh (Section 269ST)', description: 'Section 269ST bars receiving ₹2,00,000 or more in cash from one person in a day (or per transaction / event) — penalty u/s 271DA equals 100% of the amount received', dimension: 'G', severity: 'critical', enabled: true, builtIn: true, checkId: 'G5', condition: 'cashReceiptOver2L > 0', remediation: 'Day Book → filter Cash receipt vouchers → identify single-party single-day cash receipts of ₹2 lakh or more → reverse and re-collect via bank. These are prohibited and attract a 100% penalty.' },

  // ── H: Cross-Statement Reconciliation ──
  // H1 (DayBook Dr+Cr totals = TB totals) removed — compared a flow against
  // a snapshot, no theoretical basis. H2/H3/H4 cover real reconciliations.
  { id: 'H2', name: 'Sales vouchers total = TB Sales ledger',  description: 'Sum of all Sales vouchers in DayBook must match the Sales ledger closing balance in Trial Balance', dimension: 'H', severity: 'critical', enabled: true, builtIn: true, checkId: 'H2', condition: 'salesVariance > 1%', remediation: 'Compare Day Book Sales total with Trial Balance Sales ledger. Common cause: Sales returns posted to wrong ledger. Identify and reclassify.' },
  { id: 'H3', name: 'Purchase vouchers total = TB Purchase ledger', description: 'Sum of all Purchase vouchers must match the Purchase ledger closing balance', dimension: 'H', severity: 'critical', enabled: true, builtIn: true, checkId: 'H3', condition: 'purchVariance > 1%', remediation: 'Compare Day Book Purchase total with Trial Balance Purchase ledger. Check for Purchase Returns posted to wrong voucher type or different ledger.' },
  { id: 'H4', name: 'Cash + Bank movement = BS closing balance', description: 'Net cash and bank movement in DayBook must match the closing Cash + Bank balance in Balance Sheet', dimension: 'H', severity: 'critical', enabled: true, builtIn: true, checkId: 'H4', condition: 'cashBankVariance > 2%', remediation: 'Run Bank Reconciliation in Tally. Check for outstanding cheques or entries in wrong month. Ensure all bank charges and interest entries are posted.' },
  { id: 'H5', name: 'Tax vouchers = Duties & Taxes TB ledger', description: 'Total tax vouchers in DayBook must reconcile to the Duties & Taxes ledger balance in Trial Balance', dimension: 'H', severity: 'high', enabled: true, builtIn: true, checkId: 'H5', condition: 'taxMismatch === true', remediation: 'Cross-check GST payment entries in Day Book with GSTR-3B filed amounts. Identify unposted GST payments or ITC reversals and post them.' },
  { id: 'H6', name: 'Journal entry net = P&L adjustment lines', description: 'Net of all Journal vouchers should approximately align with P&L net profit adjustments', dimension: 'H', severity: 'medium', enabled: true, builtIn: true, checkId: 'H6', condition: 'journalNetMismatch > 5%', remediation: 'Review journal vouchers for mis-routed entries. Ensure closing entries (depreciation, stock, provisions) are correctly structured and don\'t double-count P&L lines.' },
  { id: 'H7', name: 'Net income−expense vouchers ≈ P&L net profit', description: 'DayBook sales totals should approximately match P&L Revenue — large variance indicates incomplete export', dimension: 'H', severity: 'high', enabled: true, builtIn: true, checkId: 'H7', condition: 'salesRevenueMismatch > 5%', remediation: 'Re-export P&L and DayBook for the same date range. Ensure all sales and service income is posted under Sales Accounts group, not under other groups.' },
  { id: 'H8', name: 'Month-wise volumes consistent — no spikes', description: 'No single month should have 3× or more the average monthly voucher count — spikes indicate bunched data entry', dimension: 'H', severity: 'medium', enabled: true, builtIn: true, checkId: 'H8', condition: 'monthMax/monthAvg >= 3', remediation: 'Identify the spike month in Day Book. If real, add a comment. If entries belong to earlier months, alter the voucher dates to the correct month and re-export.' },
];

const DIMS: DimKey[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const SEVERITIES = ['critical', 'high', 'medium', 'info'] as const;

type SeverityType = typeof SEVERITIES[number];

const SEV_COLORS: Record<string, string> = {
  critical: 'var(--red)',
  high: 'var(--coral)',
  medium: 'var(--amber)',
  info: 'var(--blue)',
};

const SEV_BG: Record<string, string> = {
  critical: 'rgba(240,72,72,0.12)',
  high:     'rgba(242,107,91,0.12)',
  medium:   'rgba(245,166,35,0.12)',
  info:     'rgba(74,158,255,0.12)',
};

function loadRules(): Rule[] {
  if (typeof window === 'undefined') return BUILTIN_RULES;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: Rule[] = JSON.parse(raw);
      // Merge: keep built-in enabled states if the user has modified them
      return BUILTIN_RULES.map(b => {
        const saved = parsed.find(r => r.id === b.id);
        return saved ? { ...b, enabled: saved.enabled } : b;
      }).concat(parsed.filter(r => !r.builtIn));
    }
  } catch {}
  return BUILTIN_RULES;
}

function saveRules(rules: Rule[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
}

const EMPTY_FORM: Omit<Rule, 'id'> = {
  name: '',
  description: '',
  dimension: 'A',
  severity: 'medium',
  enabled: true,
  builtIn: false,
  condition: '',
  remediation: '',
};

export default function RulesView() {
  const { state } = useApp();
  const { analysed, results } = state;

  const [rules, setRules] = useState<Rule[]>([]);
  const [filter, setFilter] = useState<DimKey | 'all'>('all');
  const [showModal, setShowModal] = useState(false);
  const [editRule, setEditRule] = useState<Rule | null>(null);
  const [form, setForm] = useState<Omit<Rule, 'id'>>(EMPTY_FORM);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    setRules(loadRules());
  }, []);

  const persistRules = useCallback((updated: Rule[]) => {
    setRules(updated);
    saveRules(updated);
  }, []);

  const toggleRule = (id: string) => {
    persistRules(rules.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r));
  };

  const openAdd = () => {
    setEditRule(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  };

  const openEdit = (rule: Rule) => {
    setEditRule(rule);
    setForm({ ...rule });
    setShowModal(true);
  };

  const saveRule = () => {
    if (!form.name.trim()) return;
    if (editRule) {
      persistRules(rules.map(r => r.id === editRule.id ? { ...editRule, ...form } : r));
    } else {
      const newRule: Rule = { ...form, id: `custom_${Date.now()}`, builtIn: false };
      persistRules([...rules, newRule]);
    }
    setShowModal(false);
  };

  const deleteRule = (id: string) => {
    persistRules(rules.filter(r => r.id !== id));
    setDeleteConfirm(null);
  };

  const resetToDefaults = () => {
    localStorage.removeItem(STORAGE_KEY);
    setRules(BUILTIN_RULES);
  };

  const filtered = rules.filter(r => {
    const matchDim = filter === 'all' || r.dimension === filter;
    const matchSearch = !search || r.name.toLowerCase().includes(search.toLowerCase()) || r.description.toLowerCase().includes(search.toLowerCase());
    return matchDim && matchSearch;
  });

  const enabledCount = rules.filter(r => r.enabled).length;
  const disabledCount = rules.filter(r => !r.enabled).length;
  const customCount = rules.filter(r => !r.builtIn).length;

  // Find check result for built-in rules
  const getCheckResult = (rule: Rule) => {
    if (!analysed || !results || !rule.checkId) return null;
    return results.checks.find(c => c.id === rule.checkId) ?? null;
  };

  return (
    <div className="p-6 max-w-5xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>
            Rules Engine
          </h1>
          <p className="text-xs mt-1" style={{ color: 'var(--text3)' }}>
            {enabledCount} active · {disabledCount} disabled · {customCount} custom
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={resetToDefaults}
            className="px-3 py-2 rounded-lg text-sm border transition-colors"
            style={{ borderColor: 'var(--border)', color: 'var(--text2)' }}
            title="Reset all rules to built-in defaults (clears customisations)"
          >
            Reset to defaults
          </button>
          <button
            onClick={openAdd}
            id="add-rule-btn"
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all"
            style={{ background: 'var(--teal)', color: '#000' }}
          >
            + Add Rule
          </button>
        </div>
      </div>

      {/* Score impact banner */}
      {disabledCount > 0 && (
        <div
          className="mb-4 px-4 py-3 rounded-lg text-sm border flex items-center gap-2"
          style={{ background: 'rgba(245,166,35,0.08)', borderColor: 'rgba(245,166,35,0.3)', color: 'var(--amber)' }}
        >
          ⚠ {disabledCount} rule{disabledCount > 1 ? 's' : ''} disabled — this affects your accounting health score.
          Disabled rules are excluded from score calculation.
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <input
          type="text"
          placeholder="Search rules..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="px-3 py-1.5 text-sm rounded-lg border"
          style={{ background: 'var(--bg2)', borderColor: 'var(--border)', color: 'var(--text1)', width: 200 }}
        />
        <div className="flex items-center gap-1">
          {(['all', ...DIMS] as (DimKey | 'all')[]).map(d => (
            <button
              key={d}
              onClick={() => setFilter(d)}
              className="px-2.5 py-1 text-xs rounded-md font-medium transition-colors"
              style={{
                background: filter === d ? 'var(--bg4)' : 'transparent',
                color: filter === d ? 'var(--teal)' : 'var(--text3)',
                border: `1px solid ${filter === d ? 'var(--teal)' : 'var(--border)'}`,
              }}
            >
              {d === 'all' ? 'All' : d}
            </button>
          ))}
        </div>
      </div>

      {/* Rules list */}
      <div className="space-y-2">
        {filtered.map(rule => {
          const checkResult = getCheckResult(rule);
          const statusColor =
            checkResult?.status === 'pass'    ? 'var(--green)'  :
            checkResult?.status === 'fail'    ? 'var(--red)'    :
            checkResult?.status === 'partial' ? 'var(--amber)'  :
            checkResult?.status === 'missing' ? 'var(--text3)'  :
            'var(--text3)';

          return (
            <div
              key={rule.id}
              className="rounded-xl border px-4 py-3 flex items-start gap-4"
              style={{
                background: 'var(--bg2)',
                borderColor: rule.enabled ? 'var(--border)' : 'var(--bg4)',
                opacity: rule.enabled ? 1 : 0.55,
              }}
            >
              {/* Toggle */}
              <button
                onClick={() => toggleRule(rule.id)}
                title={rule.enabled ? 'Disable rule' : 'Enable rule'}
                className="mt-0.5 w-8 h-4 rounded-full shrink-0 transition-all"
                style={{
                  background: rule.enabled ? 'var(--teal)' : 'var(--bg4)',
                  border: `2px solid ${rule.enabled ? 'var(--teal)' : 'var(--border)'}`,
                  position: 'relative',
                }}
              >
                <span
                  className="absolute top-0 w-3 h-3 rounded-full transition-all"
                  style={{
                    background: '#fff',
                    left: rule.enabled ? 'calc(100% - 14px)' : '2px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                  }}
                />
              </button>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium" style={{ color: 'var(--text1)' }}>{rule.name}</span>
                  <span
                    className="text-xs px-1.5 py-0.5 rounded font-semibold"
                    style={{ background: SEV_BG[rule.severity], color: SEV_COLORS[rule.severity] }}
                  >
                    {rule.severity.toUpperCase()}
                  </span>
                  <span
                    className="text-xs px-1.5 py-0.5 rounded font-mono"
                    style={{ background: 'var(--bg4)', color: 'var(--text2)' }}
                  >
                    {rule.dimension} · {DIM_LABELS[rule.dimension]}
                  </span>
                  {rule.builtIn && (
                    <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--bg4)', color: 'var(--text3)' }}>
                      Built-in
                    </span>
                  )}
                  {/* Live check status */}
                  {checkResult && (
                    <span className="text-xs font-medium" style={{ color: statusColor }}>
                      ● {checkResult.status.toUpperCase()}
                      {checkResult.status !== 'na' && ` (${checkResult.pts}/${checkResult.max} pts)`}
                    </span>
                  )}
                </div>
                <p className="text-xs mt-1" style={{ color: 'var(--text2)' }}>{rule.description}</p>
                {rule.condition && (
                  <p className="text-xs mt-0.5 font-mono" style={{ color: 'var(--text3)' }}>
                    Condition: {rule.condition}
                  </p>
                )}
                {/* Remediation — always shown */}
                <div
                  className="mt-2 text-xs px-3 py-2 rounded-lg border"
                  style={{ background: 'var(--bg3)', borderColor: 'var(--border)', color: 'var(--text2)' }}
                >
                  <span style={{ color: 'var(--teal)', fontWeight: 600 }}>How to fix: </span>
                  {rule.remediation}
                </div>
                {/* Check note from latest analysis */}
                {checkResult?.note && (
                  <p className="text-xs mt-1.5 italic" style={{ color: 'var(--text3)' }}>
                    Last analysis: {checkResult.note}
                  </p>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-1.5 shrink-0">
                <button
                  onClick={() => openEdit(rule)}
                  className="text-xs px-2.5 py-1 rounded border transition-colors"
                  style={{ borderColor: 'var(--border)', color: 'var(--text2)' }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--teal)')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
                >
                  Edit
                </button>
                {!rule.builtIn && (
                  <button
                    onClick={() => setDeleteConfirm(rule.id)}
                    className="text-xs px-2.5 py-1 rounded border transition-colors"
                    style={{ borderColor: 'var(--border)', color: 'var(--red)' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(240,72,72,0.1)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="text-center py-12" style={{ color: 'var(--text3)' }}>
            No rules match your search.
          </div>
        )}
      </div>

      {/* ── Add/Edit Modal ── */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={() => setShowModal(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border p-6"
            style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
            onClick={e => e.stopPropagation()}
          >
            <h2 className="text-lg mb-4" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>
              {editRule ? 'Edit Rule' : 'Add Custom Rule'}
            </h2>

            <div className="space-y-3">
              <Field label="Rule Name">
                <input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. GST Reconciliation"
                  className="w-full px-3 py-2 text-sm rounded-lg border"
                  style={{ background: 'var(--bg3)', borderColor: 'var(--border)', color: 'var(--text1)' }}
                />
              </Field>

              <Field label="Description">
                <textarea
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  rows={2}
                  placeholder="What does this rule check?"
                  className="w-full px-3 py-2 text-sm rounded-lg border resize-none"
                  style={{ background: 'var(--bg3)', borderColor: 'var(--border)', color: 'var(--text1)' }}
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Dimension">
                  <select
                    value={form.dimension}
                    onChange={e => setForm(f => ({ ...f, dimension: e.target.value as DimKey }))}
                    className="w-full px-3 py-2 text-sm rounded-lg border"
                    style={{ background: 'var(--bg3)', borderColor: 'var(--border)', color: 'var(--text1)' }}
                  >
                    {DIMS.map(d => (
                      <option key={d} value={d}>{d} — {DIM_LABELS[d]}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Severity">
                  <select
                    value={form.severity}
                    onChange={e => setForm(f => ({ ...f, severity: e.target.value as SeverityType }))}
                    className="w-full px-3 py-2 text-sm rounded-lg border"
                    style={{ background: 'var(--bg3)', borderColor: 'var(--border)', color: 'var(--text1)' }}
                  >
                    {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
              </div>

              <Field label="Condition (human-readable)">
                <input
                  value={form.condition ?? ''}
                  onChange={e => setForm(f => ({ ...f, condition: e.target.value }))}
                  placeholder="e.g. suspenseCount > 0"
                  className="w-full px-3 py-2 text-sm rounded-lg border font-mono"
                  style={{ background: 'var(--bg3)', borderColor: 'var(--border)', color: 'var(--text1)' }}
                />
              </Field>

              <Field label="Remediation / How to Fix">
                <textarea
                  value={form.remediation}
                  onChange={e => setForm(f => ({ ...f, remediation: e.target.value }))}
                  rows={3}
                  placeholder="Step-by-step instructions for the accountant to fix this issue..."
                  className="w-full px-3 py-2 text-sm rounded-lg border resize-none"
                  style={{ background: 'var(--bg3)', borderColor: 'var(--border)', color: 'var(--text1)' }}
                />
              </Field>
            </div>

            <div className="flex gap-2 mt-5 justify-end">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-sm rounded-lg border"
                style={{ borderColor: 'var(--border)', color: 'var(--text2)' }}
              >
                Cancel
              </button>
              <button
                onClick={saveRule}
                disabled={!form.name.trim()}
                className="px-4 py-2 text-sm rounded-lg font-medium"
                style={{ background: 'var(--teal)', color: '#000', opacity: form.name.trim() ? 1 : 0.5 }}
              >
                {editRule ? 'Save Changes' : 'Add Rule'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirm Modal ── */}
      {deleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={() => setDeleteConfirm(null)}
        >
          <div
            className="w-80 rounded-2xl border p-6 text-center"
            style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="text-2xl mb-3">🗑</div>
            <h3 className="text-base font-semibold mb-1" style={{ color: 'var(--text1)' }}>Delete Rule?</h3>
            <p className="text-xs mb-5" style={{ color: 'var(--text3)' }}>This action cannot be undone.</p>
            <div className="flex gap-2">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 py-2 text-sm rounded-lg border"
                style={{ borderColor: 'var(--border)', color: 'var(--text2)' }}
              >
                Cancel
              </button>
              <button
                onClick={() => deleteRule(deleteConfirm)}
                className="flex-1 py-2 text-sm rounded-lg font-medium"
                style={{ background: 'var(--red)', color: '#fff' }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text3)' }}>
        {label}
      </label>
      {children}
    </div>
  );
}
