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
  company: string;          // Tally company name as Tally knows it
  period: ReportPeriod;
  /** Per-report extra <STATICVARIABLES> entries.  Used to flip Tally's F12-style
   *  toggles (e.g. Trial Balance: "Show Opening Balance" / "Show Transactions"). */
  extraStaticVars?: string;
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
      <STATICVARIABLES>
        <SVCURRENTCOMPANY>${escapeXml(company)}</SVCURRENTCOMPANY>
        <SVFROMDATE TYPE="Date">${from}</SVFROMDATE>
        <SVTODATE TYPE="Date">${to}</SVTODATE>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        <EXPLODEFLAG>Yes</EXPLODEFLAG>${extraStaticVars}
      </STATICVARIABLES>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

/** Per-kind extra static variables.  Trial Balance asks Tally to include the
 *  Opening Balance and Transactions columns — Tally's F12 toggles are exposed
 *  through SV variables, but the exact names vary across versions (Prime 2.x
 *  vs 3.x vs 4.x and across release builds).  Setting all known candidates is
 *  safe — Tally silently ignores names it doesn't recognise.  The parser
 *  reads whichever tags actually come back, and the UI hides empty columns. */
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
};

// Map our ReportKind → the Tally REPORT id that returns the same shape the
// existing parser in lib/parser.ts already understands.
// Tally Prime built-in REPORT ids. These match the names Tally uses for
// Display → Statements / Account Books / Inventory Books menus, which is the
// same string Tally accepts as <ID> in an Export envelope.
const REPORT_IDS: Record<ReportKind, string> = {
  // Required (always pulled, parser depends on these)
  master:     'List of Accounts',
  trialbal:   'Trial Balance',
  pandl:      'Profit and Loss',
  bsheet:     'Balance Sheet',
  grpsum:     'Group Summary',
  daybook:    'Day Book',
  // Conditional — depend on company having sales/purchase/billing modules enabled
  sales:      'Sales Register',
  purchase:   'Purchase Register',
  bills:      'Bills Receivable',
  payables:   'Bills Payable',
  cashflow:   'Cash Flow',
  // Optional — may not exist in every Tally setup; sync handles per-kind errors
  faregister: 'Fixed Assets Register',
  stock:      'Stock Summary',
  bankrecon:  'Bank Reconciliation',
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
function buildDayBookCollectionRequest(company: string, period: ReportPeriod): string {
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
      <STATICVARIABLES>
        <SVCURRENTCOMPANY>${escapeXml(company)}</SVCURRENTCOMPANY>
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
function buildTrialBalanceCollectionRequest(company: string, period: ReportPeriod): string {
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
      <STATICVARIABLES>
        <SVCURRENTCOMPANY>${escapeXml(company)}</SVCURRENTCOMPANY>
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

export function buildReportRequest(
  kind: ReportKind,
  company: string,
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
  return exportEnvelope({
    reportName: REPORT_IDS[kind],
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

export function buildVoucherImportRequest(company: string, draft: VoucherDraft): string {
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
      <STATICVARIABLES>
        <SVCURRENTCOMPANY>${escapeXml(company)}</SVCURRENTCOMPANY>
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
