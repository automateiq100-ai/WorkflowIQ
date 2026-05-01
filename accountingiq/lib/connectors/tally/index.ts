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

function parseCompanies(xml: string): ConnectorCompany[] {
  const out: ConnectorCompany[] = [];
  const re = /<COMPANY[^>]*NAME="([^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const name = m[1].trim();
    if (name) out.push({ id: name, name });
  }
  // Fallback: <NAME> children
  if (out.length === 0) {
    const re2 = /<NAME>([^<]+)<\/NAME>/gi;
    while ((m = re2.exec(xml)) !== null) {
      const name = m[1].trim();
      if (name) out.push({ id: name, name });
    }
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
    const xml = await dispatchJob(session.bridgeId, {
      kind: 'tally-xml',
      payload: buildReportRequest(kind, company, period),
    });
    return { kind, xml, fetchedAt: Date.now() };
  }

  async postVoucher(session: ConnectorSession, draft: VoucherDraft): Promise<VoucherPostResult> {
    const company = session.selectedCompany?.name;
    if (!company) return { ok: false, error: 'No company selected on this Tally session' };
    const xml = await dispatchJob(session.bridgeId, {
      kind: 'tally-xml',
      payload: buildVoucherImportRequest(company, draft),
    });
    return parseVoucherImportResponse(xml);
  }
}
