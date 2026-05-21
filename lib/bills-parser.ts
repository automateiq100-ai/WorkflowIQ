/**
 * Shared Bills.xml / Payables.xml parser.
 *
 * Tally emits open bills in several display- and TDL-flavours.  parseBills()
 * walks the XML and returns a uniform Bill[] list — used by both the
 * DataView "Bills" tab and the MIS layer-2 metrics (WC3, WC4 etc.) that
 * need per-bill outstanding totals.
 */

export interface Bill {
  party: string;
  billRef: string;
  amount: number;
  dueDate: string;
  overdue: boolean;
  /** Days past due as exported by Tally's BILLOVERDUE field — when
   *  present this is the authoritative aging source (more reliable than
   *  re-deriving from the dueDate string, which may use Tally's 2-digit
   *  year or other locale-specific formats).  Negative means not yet due
   *  if Tally signs it that way; we treat anything ≤ 0 as not overdue. */
  overdueDays?: number;
  type: 'receivable' | 'payable';
}

/**
 * Parse a bill date string into a Date, or null.
 *
 *  Accepts every format Tally Prime / TDL exports throw at us:
 *   - "1-Apr-2025"  /  "01-Apr-2025"        (4-digit year)
 *   - "1-Apr-25"    /  "01-Apr-25"          (2-digit year — Tally default)
 *   - "20250401"                            (YYYYMMDD, raw TDL)
 *   - "2025-04-01"                          (ISO 8601)
 *   - "01/04/2025"  /  "01/04/25"           (DD/MM/YYYY — Indian)
 *   - "01-04-2025"  /  "01-04-25"           (DD-MM-YYYY)
 *
 *  2-digit years map to 20YY — pre-2000 bills aren't a real-world concern
 *  for this tool.  Returns null for anything we can't recognise.
 */
const MONTHS_3LETTER: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function expandYear(yearStr: string): number {
  const y = parseInt(yearStr, 10);
  return y < 100 ? 2000 + y : y;
}

export function parseBillDate(s: string): Date | null {
  if (!s) return null;
  const t = s.trim();

  // 'D-Mon-YYYY' / 'DD-Mon-YYYY' / 'D-Mon-YY' / 'DD-Mon-YY'
  const mMon = t.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{2,4})$/);
  if (mMon) {
    const mo = MONTHS_3LETTER[mMon[2].toLowerCase()];
    if (mo === undefined) return null;
    const d = new Date(expandYear(mMon[3]), mo, parseInt(mMon[1], 10));
    return isNaN(d.getTime()) ? null : d;
  }

  // 'YYYYMMDD'
  if (/^\d{8}$/.test(t)) {
    const d = new Date(parseInt(t.slice(0, 4), 10), parseInt(t.slice(4, 6), 10) - 1, parseInt(t.slice(6, 8), 10));
    return isNaN(d.getTime()) ? null : d;
  }

  // 'YYYY-MM-DD' (ISO)
  const mIso = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (mIso) {
    const d = new Date(parseInt(mIso[1], 10), parseInt(mIso[2], 10) - 1, parseInt(mIso[3], 10));
    return isNaN(d.getTime()) ? null : d;
  }

  // 'DD/MM/YYYY' or 'DD/MM/YY' or 'DD-MM-YYYY' / 'DD-MM-YY'  (Indian)
  const mDmy = t.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
  if (mDmy) {
    const d = new Date(expandYear(mDmy[3]), parseInt(mDmy[2], 10) - 1, parseInt(mDmy[1], 10));
    return isNaN(d.getTime()) ? null : d;
  }

  return null;
}

/**
 * Days a bill is past its due date as of `asOf` (defaults to now).
 *  - Positive  → overdue by that many days
 *  - Zero / negative → not yet due
 *  - null → couldn't determine
 *
 *  Priority:
 *   1. `bill.overdueDays` from Tally's BILLOVERDUE export field — most
 *      authoritative (Tally itself computed it).  Used regardless of `asOf`
 *      because Tally's number reflects the export date, which is the same
 *      "today" the user sees in their Tally GUI.
 *   2. Computed from `parseBillDate(bill.dueDate)` vs `asOf`.
 */
export function billDaysOverdue(bill: Bill, asOf: Date = new Date()): number | null {
  if (typeof bill.overdueDays === 'number' && Number.isFinite(bill.overdueDays)) {
    return bill.overdueDays;
  }
  const due = parseBillDate(bill.dueDate);
  if (!due) return null;
  return Math.floor((asOf.getTime() - due.getTime()) / 86_400_000);
}

/** Standard aging-bucket label for a days-overdue count. */
export type AgingBucket = '0–30' | '31–60' | '61–90' | '90+' | 'Not due';
export function agingBucketOf(daysOverdue: number | null): AgingBucket {
  if (daysOverdue == null || daysOverdue <= 0) return 'Not due';
  if (daysOverdue <= 30) return '0–30';
  if (daysOverdue <= 60) return '31–60';
  if (daysOverdue <= 90) return '61–90';
  return '90+';
}

/** Extract text content from the first matching tag (case-insensitive). */
function tagVal(inner: string, ...tags: string[]): string {
  for (const tag of tags) {
    const m = inner.match(new RegExp(`<${tag}[^>]*>\\s*([\\s\\S]*?)\\s*<\\/${tag}>`, 'i'));
    if (m) return m[1].trim();
  }
  return '';
}

export function parseBills(xml: string, type: 'receivable' | 'payable'): Bill[] {
  const today = new Date();
  today.setHours(0,0,0,0);
  const bills: Bill[] = [];

  function pushBill(party: string, ref: string, amtRaw: string, dueStr: string, overdueRaw: string) {
    const amount = parseFloat(amtRaw.replace(/,/g, '')) || 0;
    if (!party && !ref && amount === 0) return;
    const dueDt = parseBillDate(dueStr);
    // <BILLOVERDUE> may be Y/N, "1"/"0", or — in the TDL Bills Receivable/
    // Payable export — a count of days past due (e.g. "365").  Any positive
    // numeric value means the bill is overdue.
    const overdueRawTrim = overdueRaw.trim();
    const overdueDaysRaw = parseFloat(overdueRawTrim);
    const overdueDays = Number.isFinite(overdueDaysRaw) && /^-?\d+(\.\d+)?$/.test(overdueRawTrim)
      ? overdueDaysRaw
      : undefined;
    const overdue =
      overdueRawTrim.toLowerCase() === 'yes' ||
      overdueRawTrim === '1' ||
      (overdueDays != null && overdueDays > 0) ||
      (dueDt ? dueDt < today : false);
    bills.push({
      party, billRef: ref, amount: Math.abs(amount), dueDate: dueStr, overdue,
      overdueDays, type,
    });
  }

  // ── Format 1: DSPBILLDETAILS block (most common Tally display-report) ──
  const fmt1Re = /<DSPBILLDETAILS[^>]*>([\s\S]*?)<\/DSPBILLDETAILS>/gi;
  let m: RegExpExecArray | null;
  while ((m = fmt1Re.exec(xml)) !== null) {
    const i = m[1];
    pushBill(
      tagVal(i, 'DSPBILLPARTY', 'DSPPARTYNAME', 'DSPBILLLEDGERNAME'),
      tagVal(i, 'DSPBILLREF', 'DSPBILLNAME', 'DSPBILLREFNAME'),
      tagVal(i,
        'DSPBILLFINALAMTA', 'DSPBILLFINALAMT', 'DSPBILLFINAL',
        'DSPBILLPENDAMTA',  'DSPBILLPENDAMT',
        'DSPBILLAMTA',      'DSPBILLAMT',
        'DSPBILLOSAMTA',    'DSPBILLOSAMT',
        'DSPCLAMTA',        'DSPCLAMT',
        'DSPCLDRAMTA',      'DSPCLCRAMTA',
        'DSPCURRENTBAL',
      ),
      tagVal(i,
        'DSPBILLDUEDATE', 'DSPBILLDUE',
        'DSPBILLDATEA',   'DSPBILLDATE',
      ),
      tagVal(i,
        'DSPBILLOVERDUEA', 'DSPBILLOVERDUE',
        'DSPBILLOVRDUE',   'DSPBILLOVRDUEA',
      ),
    );
  }

  // ── Format 2: DSPBILLEDDETAILS block (alternate Tally version) ──
  if (bills.length === 0) {
    const fmt2Re = /<DSPBILLEDDETAILS[^>]*>([\s\S]*?)<\/DSPBILLEDDETAILS>/gi;
    while ((m = fmt2Re.exec(xml)) !== null) {
      const i = m[1];
      pushBill(
        tagVal(i, 'DSPBILLPARTY', 'DSPPARTYNAME', 'DSPBILLLEDGERNAME'),
        tagVal(i, 'DSPBILLREF', 'DSPBILLNAME', 'DSPBILLREFNAME'),
        tagVal(i,
          'DSPBILLFINALAMTA', 'DSPBILLFINALAMT', 'DSPBILLFINAL',
          'DSPBILLPENDAMTA',  'DSPBILLPENDAMT',
          'DSPBILLAMTA',      'DSPBILLAMT',
          'DSPBILLOSAMTA',    'DSPBILLOSAMT',
          'DSPCLAMTA',        'DSPCLAMT',
          'DSPCLDRAMTA',      'DSPCLCRAMTA',
          'DSPCURRENTBAL',
        ),
        tagVal(i,
          'DSPBILLDUEDATE', 'DSPBILLDUE',
          'DSPBILLDATEA',   'DSPBILLDATE',
        ),
        tagVal(i,
          'DSPBILLOVERDUEA', 'DSPBILLOVERDUE',
          'DSPBILLOVRDUE',   'DSPBILLOVRDUEA',
        ),
      );
    }
  }

  // ── Format 3: DSPBILLDETS / DSPBILLSDETAILS block ──
  if (bills.length === 0) {
    const fmt3Re = /<DSPBILLS?DETAILS?[^>]*>([\s\S]*?)<\/DSPBILLS?DETAILS?>/gi;
    while ((m = fmt3Re.exec(xml)) !== null) {
      const i = m[1];
      pushBill(
        tagVal(i, 'DSPBILLPARTY', 'DSPPARTYNAME', 'DSPBILLLEDGERNAME'),
        tagVal(i, 'DSPBILLREF', 'DSPBILLNAME', 'DSPBILLREFNAME'),
        tagVal(i,
          'DSPBILLFINALAMTA', 'DSPBILLFINALAMT', 'DSPBILLFINAL',
          'DSPBILLPENDAMTA',  'DSPBILLPENDAMT',
          'DSPBILLAMTA',      'DSPBILLAMT',
          'DSPBILLOSAMTA',    'DSPBILLOSAMT',
          'DSPCLAMTA',        'DSPCLAMT',
          'DSPCLDRAMTA',      'DSPCLCRAMTA',
          'DSPCURRENTBAL',
        ),
        tagVal(i,
          'DSPBILLDUEDATE', 'DSPBILLDUE',
          'DSPBILLDATEA',   'DSPBILLDATE',
        ),
        tagVal(i,
          'DSPBILLOVERDUEA', 'DSPBILLOVERDUE',
          'DSPBILLOVRDUE',   'DSPBILLOVRDUEA',
        ),
      );
    }
  }

  // ── Format 4: LEDGER > BILLALLOCATIONS (data export format) ──
  if (bills.length === 0) {
    const ledgerRe = /<LEDGER\b[^>]*NAME="([^"]*)"[^>]*>([\s\S]*?)<\/LEDGER>/gi;
    while ((m = ledgerRe.exec(xml)) !== null) {
      const partyName = m[1].trim();
      const ledgerBody = m[2];
      const allocRe = /<BILLALLOCATIONS[^>]*>([\s\S]*?)<\/BILLALLOCATIONS>/gi;
      let am: RegExpExecArray | null;
      while ((am = allocRe.exec(ledgerBody)) !== null) {
        const i = am[1];
        const ref = tagVal(i, 'NAME', 'BILLNAME');
        const amtRaw = tagVal(i, 'AMOUNT', 'BILLAMOUNT');
        const dueStr = tagVal(i, 'DUEDATE', 'BILLDATE');
        if (ref || amtRaw) {
          pushBill(partyName, ref, amtRaw, dueStr, '');
        }
      }
    }
  }

  // ── Format 5: flat BILLFIXED structure (TDL Bills Receivable/Payable) ──
  // Each bill: <BILLFIXED> header + sibling tags (BILLCL, BILLDUE,
  // BILLOVERDUE, BILLVCHAMOUNT) until the next BILLFIXED.
  if (bills.length === 0) {
    const fmt5Re = /<BILLFIXED>([\s\S]*?)(?=<BILLFIXED>|<\/ENVELOPE>|$)/gi;
    while ((m = fmt5Re.exec(xml)) !== null) {
      const chunk = m[0];
      pushBill(
        tagVal(chunk, 'BILLPARTY'),
        tagVal(chunk, 'BILLREF', 'BILLVCHNUMBER'),
        // Prefer BILLCL (current outstanding) — accounts for partial settlements.
        tagVal(chunk, 'BILLCL', 'BILLVCHAMOUNT', 'BILLFINAL', 'BILLAMOUNT'),
        tagVal(chunk, 'BILLDUE', 'BILLDUEDATE', 'BILLDATE'),
        tagVal(chunk, 'BILLOVERDUE'),
      );
    }
  }

  return bills;
}
