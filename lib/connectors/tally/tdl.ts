// Tally Definition Language (TDL) request envelopes.
//
// Tally Prime exposes an XML/HTTP gateway on http://localhost:9000.
// Each request is a TALLYREQUEST envelope describing what to Export.
// All values here are deterministic — snapshot-tested in __tests__/.
//
// Reference: https://help.tallysolutions.com/case-study-1/

import type { ReportKind, ReportPeriod, VoucherDraft } from '../types';

function toTallyDate(iso: string): string {
  // YYYY-MM-DD → YYYYMMDD (Tally's native date format)
  return iso.replaceAll('-', '');
}

function escapeXml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

interface ExportArgs {
  reportName: string;       // Tally REPORT id, e.g. "Trial Balance"
  company?: string;         // Tally company name; OMITTED when empty (see currentCompanyVar)
  period: ReportPeriod;
  /** Per-report extra <STATICVARIABLES> entries.  Used to flip Tally's F12-style
   *  toggles (e.g. Trial Balance: "Show Opening Balance" / "Show Transactions"). */
  extraStaticVars?: string;
}

/**
 * Build the optional `<SVCURRENTCOMPANY>` static-variable line.
 *
 * IMPORTANT — we deliberately OMIT this for the normal export path.
 *
 * Tally Prime crashes with a c0000005 memory-access violation (which kills
 * its XML server, after which every subsequent request gets ECONNREFUSED)
 * when asked to resolve SVCURRENTCOMPANY for a company whose LOADED name
 * carries multi-year "- (from <date>)" annotations, e.g.
 *   "NARNKAR & CO - (from 1-Apr-2020) - (from 1-Apr-21) - (from 1-Apr-22)".
 * Both the full annotated name AND the bare "NARNKAR & CO" fail to resolve
 * ("Could not set 'SVCurrentCompany' to '…'"), and the failed resolution is
 * what trips the crash.
 *
 * Omitting the variable makes Tally export from the currently-open company —
 * exactly the one the user is looking at in the Gateway — sidestepping the
 * crash-prone resolution path entirely.  This mirrors how the working
 * "List of Companies" request already behaves (it never sends the variable).
 *
 * A non-empty `company` is only emitted if a caller explicitly opts in
 * (e.g. a future multi-company batch path); the default callers pass none.
 */
function currentCompanyVar(company?: string): string {
  if (!company || !company.trim()) return '';
  return `\n        <SVCURRENTCOMPANY>${escapeXml(company)}</SVCURRENTCOMPANY>`;
}

function exportEnvelope({ reportName, company, period, extraStaticVars = '' }: ExportArgs): string {
  const from = toTallyDate(period.start);
  const to = toTallyDate(period.end);
  return `<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>${escapeXml(reportName)}</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>${currentCompanyVar(company)}
        <SVFROMDATE TYPE="Date">${from}</SVFROMDATE>
        <SVTODATE TYPE="Date">${to}</SVTODATE>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        <EXPLODEFLAG>Yes</EXPLODEFLAG>${extraStaticVars}
      </STATICVARIABLES>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

/** Per-kind extra static variables.  Two main uses:
 *  1. Flip Tally's F12-style toggles (e.g. Trial Balance: "Show Opening
 *     Balance" / "Show Transactions").
 *  2. Pre-select scope for reports that open with a picker dialog
 *     (Group Summary / Bills Receivable / Bills Payable / Sales Register
 *     / Purchase Register / Cash Flow).  Without this, Tally Prime
 *     halts the export waiting for the user to dismiss the dialog —
 *     forcing the user to switch to Tally to "close the issue" before
 *     the live sync can proceed.
 *
 *  Exact variable names vary across Tally Prime versions (2.x / 3.x / 4.x
 *  and across release builds), so we set all known candidates — Tally
 *  silently ignores names it doesn't recognise.  Pattern matches the
 *  existing trialbal block. */
const EXTRA_STATIC_VARS: Partial<Record<ReportKind, string>> = {
  trialbal: `
        <ISITRRBOPNGBAL>Yes</ISITRRBOPNGBAL>
        <ISITRRBTRANS>Yes</ISITRRBTRANS>
        <ROPNGBAL>Yes</ROPNGBAL>
        <RTRANS>Yes</RTRANS>
        <SVROPNGBAL>Yes</SVROPNGBAL>
        <SVRTRANS>Yes</SVRTRANS>
        <DETAILED>Yes</DETAILED>
        <ISDETAILED>Yes</ISDETAILED>
        <SHOWOPENING>Yes</SHOWOPENING>
        <SHOWTRANSACTIONS>Yes</SHOWTRANSACTIONS>
        <TBONALLLEDGER>Yes</TBONALLLEDGER>
        <SHOWFORACCOUNTS>Yes</SHOWFORACCOUNTS>`,
  // Group Summary opens with "Select Group: <picker>" in Tally Prime.
  // Pre-select "Primary" so the report runs against the full chart of
  // accounts (every group rolls up to Primary).  All variant names
  // included because the canonical name differs across Tally builds.
  grpsum: `
        <DSPACCNAME>Primary</DSPACCNAME>
        <SVACCNAME>Primary</SVACCNAME>
        <ACCOUNTNAME>Primary</ACCOUNTNAME>
        <DSPGROUPNAME>Primary</DSPGROUPNAME>
        <SVGROUPNAME>Primary</SVGROUPNAME>
        <SVCURRENTGROUP>Primary</SVCURRENTGROUP>
        <ISSHOWOWNGROUP>No</ISSHOWOWNGROUP>
        <ISGRPSUMMARY>Yes</ISGRPSUMMARY>
        <EXPANDFLAG>Yes</EXPANDFLAG>`,
  // Bills Receivable / Bills Payable open with "Bills Receivable for:
  // <ledger picker>".  Pre-select "All Items" / "All Ledgers" so the
  // report aggregates across every party.
  bills: `
        <DSPACCNAME>All Items</DSPACCNAME>
        <SVACCNAME>All Items</SVACCNAME>
        <ACCOUNTNAME>All Items</ACCOUNTNAME>
        <ISALLITEMS>Yes</ISALLITEMS>
        <SHOWALLBILLS>Yes</SHOWALLBILLS>`,
  payables: `
        <DSPACCNAME>All Items</DSPACCNAME>
        <SVACCNAME>All Items</SVACCNAME>
        <ACCOUNTNAME>All Items</ACCOUNTNAME>
        <ISALLITEMS>Yes</ISALLITEMS>
        <SHOWALLBILLS>Yes</SHOWALLBILLS>`,
  // Sales / Purchase Register open with "Sales Register: <voucher type
  // picker>" in some Tally Prime builds.  Pre-select "All Vouchers"
  // (which is also the menu's default label) so the export covers
  // every voucher type without prompting.
  sales: `
        <DSPACCNAME>All Vouchers</DSPACCNAME>
        <SVACCNAME>All Vouchers</SVACCNAME>
        <VOUCHERTYPENAME>All Vouchers</VOUCHERTYPENAME>
        <ISALLVOUCHERS>Yes</ISALLVOUCHERS>`,
  purchase: `
        <DSPACCNAME>All Vouchers</DSPACCNAME>
        <SVACCNAME>All Vouchers</SVACCNAME>
        <VOUCHERTYPENAME>All Vouchers</VOUCHERTYPENAME>
        <ISALLVOUCHERS>Yes</ISALLVOUCHERS>`,
  // Cash Flow opens with a "Period: monthly / quarterly / yearly"
  // selector in some Tally Prime versions.  Force monthly granularity
  // (the most data-rich option) and full-period scope.
  cashflow: `
        <SVPERIODICITY>Monthly</SVPERIODICITY>
        <PERIODICITY>Monthly</PERIODICITY>
        <ISMONTHLY>Yes</ISMONTHLY>
        <EXPLODEFLAG>Yes</EXPLODEFLAG>`,
};

// Map our ReportKind → the Tally REPORT id that returns the same shape the
// existing parser in lib/parser.ts already understands.
// Tally Prime built-in REPORT ids. These match the names Tally uses for
// Display → Statements / Account Books / Inventory Books menus, which is the
// same string Tally accepts as <ID> in an Export envelope.
/** Tally Prime built-in report IDs accepted by `<ID>…</ID>` in an Export
 *  envelope.  Only includes reports that exist as standalone TDL-callable
 *  reports.  Anything that's a drill-down (Group Summary → Fixed Assets)
 *  or an interactive workflow (F5 Bank Reconciliation) is fetched via a
 *  custom Collection — see buildReportRequest. */
const REPORT_IDS: Partial<Record<ReportKind, string>> = {
  // Required (always pulled, parser depends on these)
  master:     'List of Accounts',
  // trialbal handled via custom WIQTrialBalance collection (see buildReportRequest)
  pandl:      'Profit and Loss',
  bsheet:     'Balance Sheet',
  grpsum:     'Group Summary',
  // daybook handled via custom WIQDayBook collection (see buildReportRequest)
  // Conditional — depend on company having sales/purchase/billing modules enabled
  sales:      'Sales Register',
  purchase:   'Purchase Register',
  bills:      'Bills Receivable',
  payables:   'Bills Payable',
  cashflow:   'Cash Flow',
  // Optional
  // faregister handled via custom WIQFixedAssets collection (see buildReportRequest)
  stock:      'Stock Summary',
  // bankrecon: NO entry — Tally Prime has no standalone Bank Reconciliation
  //   report.  F5 (Reconcile) is an interactive workflow on each bank
  //   ledger.  The sync skips this kind; users export it manually per
  //   bank ledger if they need the BRS data.
};

/**
 * Custom TDL collection request that fetches every Voucher whose date falls
 * within [SVFROMDATE, SVTODATE].
 *
 * Why this exists: Tally Prime's built-in "Day Book" report is single-day
 * by design — even when SVFROMDATE/SVTODATE span a year, Tally returns only
 * the SVTODATE day's vouchers.  A custom Voucher collection with a $Date
 * filter sidesteps that completely and gives us full-period coverage in one
 * round-trip.  The response shape is still <VOUCHER>…</VOUCHER> blocks with
 * the standard child tags (DATE, VOUCHERNUMBER, VOUCHERTYPENAME, NARRATION,
 * PARTYLEDGERNAME, AMOUNT, ALLLEDGERENTRIES.LIST), so the existing
 * parseDayBook regex works unchanged.
 */
function buildDayBookCollectionRequest(company: string | undefined, period: ReportPeriod): string {
  const from = toTallyDate(period.start);
  const to = toTallyDate(period.end);
  // Tally's Voucher collection is already scoped to [SVFROMDATE, SVTODATE]
  // when those statics are set — no FILTER needed (and writing one needs
  // $$Date:## coercion, which we got wrong on the first attempt and Tally
  // silently returned zero vouchers).  BELONGSTO=Yes ensures we get every
  // voucher in the company's books (no narrower view).
  return `<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>WIQDayBook</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>${currentCompanyVar(company)}
        <SVFROMDATE TYPE="Date">${from}</SVFROMDATE>
        <SVTODATE TYPE="Date">${to}</SVTODATE>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="WIQDayBook" ISMODIFY="No">
            <TYPE>Voucher</TYPE>
            <BELONGSTO>Yes</BELONGSTO>
            <FETCH>Date</FETCH>
            <FETCH>VoucherNumber</FETCH>
            <FETCH>VoucherTypeName</FETCH>
            <FETCH>Narration</FETCH>
            <FETCH>PartyLedgerName</FETCH>
            <FETCH>Amount</FETCH>
            <FETCH>AllLedgerEntries.LedgerName</FETCH>
            <FETCH>AllLedgerEntries.Amount</FETCH>
            <FETCH>AllLedgerEntries.IsDeemedPositive</FETCH>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

/**
 * Custom TDL collection for the Trial Balance — bypasses Tally's built-in
 * "Trial Balance" REPORT entirely.
 *
 * Why: the built-in TB only emits period Dr/Cr movement columns when the
 * F12 toggle "Show Transactions" is on, and the static-variable name that
 * triggers that toggle differs across Tally Prime releases (we set every
 * known candidate but no single set works on every install).  A custom
 * Ledger collection sidesteps the toggle — Tally always emits NAME,
 * PARENT, OPENINGBALANCE and CLOSINGBALANCE on a Ledger collection when
 * SVFROMDATE / SVTODATE are set, regardless of any UI configuration.
 *
 * From OpeningBalance and ClosingBalance the engine derives net period
 * movement per ledger (closing − opening), which is enough for H4's
 * "DayBook cash/bank flow ≈ TB cash/bank movement" cross-check.  The
 * parser's existing <LEDGER>-block fallback reads this shape natively.
 */
/**
 * Custom Collection for Fixed-Asset ledgers.
 *
 * Why this exists: Tally Prime does NOT have a built-in report called
 * "Fixed Assets Register" at the TDL level — the manual export path uses
 * Group Summary → Fixed Assets, which is a drill-down into a specific
 * primary group, not a standalone report.  Asking Tally for
 * `<ID>Fixed Assets Register</ID>` produces a LINEERROR.
 *
 * Solution: a custom Ledger collection filtered to ledgers whose Primary
 * Group is "Fixed Assets" (the default Tally group name; any ledger
 * classified under it inherits through `$PrimaryGroup`).  Closing
 * balance + parent path are enough to populate the Fixed Asset Register
 * slot — the parser's `<LEDGER>`-block fallback reads this shape natively.
 */
/** Fixed Assets export via Tally Prime's built-in Group Summary report
 *  with `<DSPACCNAME>Fixed Assets</DSPACCNAME>` pre-selected as the scope.
 *
 *  Why this approach: a custom Collection with `<FILTER>` + `<SYSTEM>`
 *  declaration ran into TDL dictionary lookup quirks across Tally Prime
 *  versions ("Description not found: System Formulae - 'WIQFAFilter'")
 *  no matter whether the SYSTEM TYPE was set to "Formula" or "Formulae",
 *  or whether the body used <VALUE> or <FORMULA>.  Built-in reports are
 *  much more reliable because they're version-stable, and the scope
 *  pre-selection trick (same one we use for grpsum's "Primary" group)
 *  is the documented way to drive Group Summary without an interactive
 *  picker.
 *
 *  Output shape: standard Tally Group Summary XML — the existing
 *  `<DSPACCNAME>` / `<DSPCLAMTA>` blocks the trial balance parser
 *  already understands.  Drill-downs into per-ledger detail happen
 *  client-side via the parsed `Parent` field. */
function buildFixedAssetsCollectionRequest(company: string | undefined, period: ReportPeriod): string {
  return exportEnvelope({
    reportName: 'Group Summary',
    company,
    period,
    extraStaticVars: `
        <DSPACCNAME>Fixed Assets</DSPACCNAME>
        <SVACCNAME>Fixed Assets</SVACCNAME>
        <ACCOUNTNAME>Fixed Assets</ACCOUNTNAME>
        <DSPGROUPNAME>Fixed Assets</DSPGROUPNAME>
        <SVGROUPNAME>Fixed Assets</SVGROUPNAME>
        <SVCURRENTGROUP>Fixed Assets</SVCURRENTGROUP>
        <ISSHOWOWNGROUP>No</ISSHOWOWNGROUP>
        <EXPANDFLAG>Yes</EXPANDFLAG>`,
  });
}

function buildTrialBalanceCollectionRequest(company: string | undefined, period: ReportPeriod): string {
  const from = toTallyDate(period.start);
  const to = toTallyDate(period.end);
  return `<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>WIQTrialBalance</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>${currentCompanyVar(company)}
        <SVFROMDATE TYPE="Date">${from}</SVFROMDATE>
        <SVTODATE TYPE="Date">${to}</SVTODATE>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="WIQTrialBalance" ISMODIFY="No">
            <TYPE>Ledger</TYPE>
            <BELONGSTO>Yes</BELONGSTO>
            <FETCH>NAME</FETCH>
            <FETCH>PARENT</FETCH>
            <FETCH>OPENINGBALANCE</FETCH>
            <FETCH>CLOSINGBALANCE</FETCH>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}


/** Sentinel prefix on error messages for `ReportKind` values that
 *  intentionally have no Tally-side implementation (e.g. `bankrecon`
 *  requires per-ledger F5 workflow).  The UI splits these out from real
 *  Tally errors so users see them as a separate "skipped — export
 *  manually" category instead of a generic failure. */
export const MANUAL_ONLY_PREFIX = 'MANUAL_ONLY: ';

export class ReportNotAvailableError extends Error {
  manualOnly = true;
  constructor(public kind: ReportKind, reason: string) {
    super(MANUAL_ONLY_PREFIX + reason);
    this.name = 'ReportNotAvailableError';
  }
}

export function buildReportRequest(
  kind: ReportKind,
  company: string | undefined,
  period: ReportPeriod,
): string {
  // Day Book in Tally is a single-day report; route it through a custom
  // Voucher collection so the requested date range is actually honored.
  if (kind === 'daybook') {
    return buildDayBookCollectionRequest(company, period);
  }
  // Trial Balance: bypass the built-in report so we always get the
  // period movement data H4 needs, without depending on F12 toggles.
  if (kind === 'trialbal') {
    return buildTrialBalanceCollectionRequest(company, period);
  }
  // Fixed Assets: no standalone "Fixed Assets Register" report exists in
  // Tally Prime — use a custom Ledger collection filtered to ledgers
  // under the Fixed Assets primary group.
  if (kind === 'faregister') {
    return buildFixedAssetsCollectionRequest(company, period);
  }
  // Bank Reconciliation has no Tally-side implementation — F5 is an
  // interactive per-ledger workflow.  Throwing here lets the connector
  // skip the network round-trip and surface a clean "manual-only"
  // status instead of a Tally LINEERROR.
  if (kind === 'bankrecon') {
    throw new ReportNotAvailableError(
      kind,
      'Bank Reconciliation has no standalone report in Tally Prime — F5 is per-ledger. Export manually from Account Books → Cash/Bank Books → <Bank Ledger> → F5.',
    );
  }
  const reportName = REPORT_IDS[kind];
  if (!reportName) {
    throw new ReportNotAvailableError(kind, `No Tally report mapping for "${kind}"`);
  }
  return exportEnvelope({
    reportName,
    company,
    period,
    extraStaticVars: EXTRA_STATIC_VARS[kind],
  });
}

export function buildListCompaniesRequest(): string {
  // "List of Companies" returns a COLLECTION of CMPCOMPANY entries.
  return `<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>List of Companies</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="List of Companies" ISMODIFY="No">
            <TYPE>Company</TYPE>
            <FETCH>NAME</FETCH>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

export function buildVoucherImportRequest(company: string | undefined, draft: VoucherDraft): string {
  const lines = draft.lines
    .map((l) => {
      // Tally voucher import sign convention: ISDEEMEDPOSITIVE=No → amount is Cr.
      // We store amount as positive=Cr, negative=Dr (matches the rest of accountingIQ).
      const isDr = l.amount < 0;
      const amt = Math.abs(l.amount).toFixed(2);
      return `        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>${escapeXml(l.ledger)}</LEDGERNAME>
          <ISDEEMEDPOSITIVE>${isDr ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>
          <AMOUNT>${isDr ? '-' : ''}${amt}</AMOUNT>
        </ALLLEDGERENTRIES.LIST>`;
    })
    .join('\n');

  return `<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Import</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>Vouchers</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>${currentCompanyVar(company)}
      </STATICVARIABLES>
    </DESC>
    <DATA>
      <TALLYMESSAGE xmlns:UDF="TallyUDF">
        <VOUCHER VCHTYPE="${escapeXml(draft.voucherType)}" ACTION="Create">
          <DATE>${escapeXml(draft.date)}</DATE>
          <NARRATION>${escapeXml(draft.narration)}</NARRATION>
          <VOUCHERTYPENAME>${escapeXml(draft.voucherType)}</VOUCHERTYPENAME>
${lines}
        </VOUCHER>
      </TALLYMESSAGE>
    </DATA>
  </BODY>
</ENVELOPE>`;
}
