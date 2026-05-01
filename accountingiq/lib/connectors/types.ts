// Generic ERP connector interface. Tally is the first implementation;
// Busy / QuickBooks slot in by adding new files under lib/connectors/<id>/.

import type { FileKey } from '@/lib/types';

export type ConnectorId = 'tally' | 'busy' | 'quickbooks';

// Reports the connector can pull. Aligned with FileKey so parsed XML can be
// fed straight into the existing parser pipeline. Includes required + conditional
// + optional reports — best-effort: optional reports may fail if the user's
// Tally company doesn't have them enabled, which the sync route surfaces per-kind.
export type ReportKind = Extract<
  FileKey,
  | 'master' | 'trialbal' | 'pandl' | 'bsheet' | 'grpsum' | 'daybook'
  | 'sales' | 'purchase' | 'bills' | 'payables' | 'cashflow'
  | 'faregister' | 'stock' | 'bankrecon'
>;

export interface ReportPeriod {
  // ISO date strings (YYYY-MM-DD)
  start: string;
  end: string;
}

export interface ConnectorCompany {
  id: string;     // ERP-native company identifier
  name: string;
}

export interface ConnectorSession {
  connectorId: ConnectorId;
  bridgeId: string;          // identifies the paired bridge instance
  selectedCompany?: ConnectorCompany;
  pairedAt: number;
}

export interface FetchedReport {
  kind: ReportKind;
  // Raw XML returned by the ERP. Hand straight to lib/parser.ts.
  xml: string;
  fetchedAt: number;
}

export interface VoucherLine {
  ledger: string;
  amount: number;            // positive = Cr, negative = Dr (matches Tally sign convention used elsewhere)
}

export interface VoucherDraft {
  date: string;              // YYYYMMDD
  voucherType: 'Journal' | 'Receipt' | 'Payment' | 'Contra';
  narration: string;
  lines: VoucherLine[];      // must net to zero
  // Trace: which engine.ts Check.id triggered this fix. Logged for audit.
  sourceCheckId?: string;
}

export interface VoucherPostResult {
  ok: boolean;
  voucherNumber?: string;
  error?: string;
}

export interface ConnectorCapabilities {
  reads: ReportKind[];
  writes: boolean;
}

export interface ERPConnector {
  readonly id: ConnectorId;
  readonly label: string;
  capabilities(): ConnectorCapabilities;

  // Pairing handshake: cloud issues a one-time code, user pastes it into the
  // local bridge, bridge authenticates against /api/tally/bridge-poll with the
  // code, cloud completes the session.
  listCompanies(session: ConnectorSession): Promise<ConnectorCompany[]>;
  fetchReport(session: ConnectorSession, kind: ReportKind, period: ReportPeriod): Promise<FetchedReport>;
  postVoucher(session: ConnectorSession, draft: VoucherDraft): Promise<VoucherPostResult>;
}
