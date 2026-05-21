// Tally connector — runs in the cloud (Next.js server).
// All ERP-specific XML lives here and in ./tdl. The connector dispatches
// jobs to the user's local bridge via lib/connectors/bridge-bus.ts.

import type {
  ERPConnector,
  ConnectorCapabilities,
  ConnectorCompany,
  ConnectorSession,
  FetchedReport,
  ReportKind,
  ReportPeriod,
  VoucherDraft,
  VoucherPostResult,
} from '../types';
import { dispatchJob } from '../bridge-bus';
import {
  buildReportRequest,
  buildListCompaniesRequest,
  buildVoucherImportRequest,
} from './tdl';

const READS: ReportKind[] = [
  'master', 'trialbal', 'pandl', 'bsheet', 'grpsum', 'daybook',
  'sales', 'purchase', 'bills', 'payables', 'cashflow',
  'faregister', 'stock', 'bankrecon',
];

/**
 * Tally's "List of Companies" collection returns the company's ON-DISK
 * `$Name`, which can carry financial-year annotations when a company has
 * books split across multiple years, e.g.:
 *
 *   "NARNKAR & CO - (from 1-Apr-2020) - (from 1-Apr-21) - (from 1-Apr-22)"
 *
 * But SVCURRENTCOMPANY must match the LOADED company name (`$$CmpName`),
 * which is just "NARNKAR & CO".  Sending the annotated string makes Tally
 * fail to resolve the company and — in Tally Prime — crash with a c0000005
 * memory-access violation that kills its XML server, after which every
 * subsequent request gets ECONNREFUSED.
 *
 * Strip everything from the first " - (from <date>" annotation onward, plus
 * any trailing decode-entity artefacts, to recover the bare company name.
 */
export function normalizeTallyCompanyName(raw: string): string {
  return raw
    .replace(/&amp;/gi, '&')                 // decode the one entity Tally double-emits
    .replace(/\s*-\s*\(\s*from\b[\s\S]*$/i, '') // drop " - (from 1-Apr-20) - (from …)" tail
    .replace(/\s+/g, ' ')
    .trim();
}

function parseCompanies(xml: string): ConnectorCompany[] {
  const seen = new Set<string>();
  const out: ConnectorCompany[] = [];
  const push = (rawName: string) => {
    const name = normalizeTallyCompanyName(rawName);
    if (!name) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;   // collapse multi-year books into one entry
    seen.add(key);
    out.push({ id: name, name });
  };

  const re = /<COMPANY[^>]*NAME="([^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) push(m[1].trim());

  // Fallback: <NAME> children
  if (out.length === 0) {
    const re2 = /<NAME>([^<]+)<\/NAME>/gi;
    while ((m = re2.exec(xml)) !== null) push(m[1].trim());
  }
  return out;
}

function parseVoucherImportResponse(xml: string): VoucherPostResult {
  // Tally returns a RESPONSE element with CREATED/ALTERED/ERRORS counts.
  const created = /<CREATED>(\d+)<\/CREATED>/i.exec(xml)?.[1];
  const errors = /<ERRORS>(\d+)<\/ERRORS>/i.exec(xml)?.[1];
  const lineErr = /<LINEERROR>([^<]+)<\/LINEERROR>/i.exec(xml)?.[1];
  if (errors && parseInt(errors, 10) > 0) {
    return { ok: false, error: lineErr ?? `Tally reported ${errors} error(s)` };
  }
  if (created && parseInt(created, 10) > 0) {
    const vno = /<VOUCHERNUMBER>([^<]+)<\/VOUCHERNUMBER>/i.exec(xml)?.[1];
    return { ok: true, voucherNumber: vno };
  }
  return { ok: false, error: 'Tally response did not confirm creation' };
}

export class TallyConnector implements ERPConnector {
  readonly id = 'tally' as const;
  readonly label = 'Tally Prime';

  capabilities(): ConnectorCapabilities {
    return { reads: READS, writes: true };
  }

  async listCompanies(session: ConnectorSession): Promise<ConnectorCompany[]> {
    const xml = await dispatchJob(session.bridgeId, {
      kind: 'tally-xml',
      payload: buildListCompaniesRequest(),
    });
    return parseCompanies(xml);
  }

  async fetchReport(
    session: ConnectorSession,
    kind: ReportKind,
    period: ReportPeriod,
  ): Promise<FetchedReport> {
    const company = session.selectedCompany?.name;
    if (!company) throw new Error('No company selected on this Tally session');
    // We intentionally do NOT pass the company into the request envelope.
    // Setting SVCURRENTCOMPANY for a multi-year company (loaded name carries
    // "- (from <date>)" annotations) makes Tally Prime crash with a
    // c0000005 memory-access violation that kills its XML server — and even
    // the bare name fails to resolve.  Omitting it exports from the
    // currently-open company, which is the one the user selected in the UI
    // and is looking at in the Gateway.  (See currentCompanyVar in tdl.ts.)
    const xml = await dispatchJob(session.bridgeId, {
      kind: 'tally-xml',
      payload: buildReportRequest(kind, undefined, period),
    });
    return { kind, xml, fetchedAt: Date.now() };
  }

  async postVoucher(session: ConnectorSession, draft: VoucherDraft): Promise<VoucherPostResult> {
    const company = session.selectedCompany?.name;
    if (!company) return { ok: false, error: 'No company selected on this Tally session' };
    // Same rationale as fetchReport: omit SVCURRENTCOMPANY so Tally imports
    // into the currently-open company and we never hit the multi-year
    // name-resolution crash.  (See currentCompanyVar in tdl.ts.)
    const xml = await dispatchJob(session.bridgeId, {
      kind: 'tally-xml',
      payload: buildVoucherImportRequest(undefined, draft),
    });
    return parseVoucherImportResponse(xml);
  }
}
