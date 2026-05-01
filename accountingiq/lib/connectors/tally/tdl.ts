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
}

function exportEnvelope({ reportName, company, period }: ExportArgs): string {
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
        <EXPLODEFLAG>Yes</EXPLODEFLAG>
      </STATICVARIABLES>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

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

export function buildReportRequest(
  kind: ReportKind,
  company: string,
  period: ReportPeriod,
): string {
  return exportEnvelope({ reportName: REPORT_IDS[kind], company, period });
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
