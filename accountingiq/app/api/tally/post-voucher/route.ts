// POST /api/tally/post-voucher
// Body: { bridgeId, draft: VoucherDraft }
// Pushes a single voucher into the paired Tally company.

import { NextResponse } from 'next/server';
import { getUserId } from '@/lib/connectors/auth';
import { getSessionForUser, toClientSession } from '@/lib/connectors/session-store';
import { getConnector } from '@/lib/connectors/registry';
import type { VoucherDraft } from '@/lib/connectors/types';

function validateDraft(d: VoucherDraft): string | null {
  if (!d.date || !/^\d{8}$/.test(d.date)) return 'date must be YYYYMMDD';
  if (!Array.isArray(d.lines) || d.lines.length < 2) return 'voucher needs at least 2 lines';
  const sum = d.lines.reduce((a, l) => a + (Number.isFinite(l.amount) ? l.amount : NaN), 0);
  if (!Number.isFinite(sum)) return 'non-numeric amount';
  if (Math.abs(sum) > 0.01) return `lines do not net to zero (residual ${sum.toFixed(2)})`;
  for (const l of d.lines) if (!l.ledger?.trim()) return 'each line needs a ledger';
  return null;
}

export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const bridgeId = body.bridgeId as string | undefined;
  const draft = body.draft as VoucherDraft | undefined;
  if (!bridgeId || !draft) return NextResponse.json({ error: 'Missing bridgeId or draft' }, { status: 400 });

  const issue = validateDraft(draft);
  if (issue) return NextResponse.json({ error: issue }, { status: 400 });

  const session = getSessionForUser(userId, bridgeId);
  if (!session) return NextResponse.json({ error: 'No bridge session' }, { status: 404 });

  try {
    const result = await getConnector('tally').postVoucher(toClientSession(session), draft);
    // Audit trail — minimal stdout log; wire into Supabase audit_log table later.
    console.log('[tally write-back]', {
      userId, bridgeId, sourceCheckId: draft.sourceCheckId,
      voucherType: draft.voucherType, ok: result.ok, vno: result.voucherNumber,
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 502 });
  }
}
