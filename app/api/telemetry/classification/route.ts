/**
 * /api/telemetry/classification — POST a per-run classification summary.
 *
 * Called from analyseFiles() (lib/engine.ts) at the end of every analysis
 * so we accumulate aggregate evidence about which catalog patterns are
 * working and which need to be added.  Best-effort: failures are
 * swallowed — telemetry must never block the user-visible flow.
 *
 * Body shape (see lib/telemetry.ts ClassificationSummary):
 *   {
 *     company_id, total_ledgers, ledger_<level>, unclassified_ledgers,
 *     low_conf_ledgers, unknown_voucher_types, industry, files_loaded
 *   }
 */

import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

async function getUser() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        },
      },
    },
  );
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
  );
}

async function ownsCompany(userId: string, companyId: string): Promise<boolean> {
  const admin = adminClient();
  const { data, error } = await admin
    .from('accountingiq_companies')
    .select('id')
    .eq('id', companyId)
    .eq('owner_user_id', userId)
    .maybeSingle();
  return !error && !!data;
}

export async function POST(request: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || !body.company_id) {
    return NextResponse.json({ error: 'company_id required' }, { status: 400 });
  }
  if (!(await ownsCompany(user.id, body.company_id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Cap array sizes to keep rows manageable — first 200 names cover the
  // long tail of any sensible chart of accounts.
  const cap = (xs: unknown): string[] => Array.isArray(xs) ? xs.slice(0, 200).filter((x): x is string => typeof x === 'string') : [];

  const admin = adminClient();
  const { error } = await admin
    .from('accountingiq_classification_telemetry')
    .insert({
      company_id:            body.company_id,
      user_id:               user.id,
      total_ledgers:         Math.max(0, Number(body.total_ledgers) || 0),
      ledger_overridden:     Math.max(0, Number(body.ledger_overridden) || 0),
      ledger_high:           Math.max(0, Number(body.ledger_high) || 0),
      ledger_medium:         Math.max(0, Number(body.ledger_medium) || 0),
      ledger_low:            Math.max(0, Number(body.ledger_low) || 0),
      ledger_none:           Math.max(0, Number(body.ledger_none) || 0),
      unclassified_ledgers:  cap(body.unclassified_ledgers),
      low_conf_ledgers:      cap(body.low_conf_ledgers),
      unknown_voucher_types: cap(body.unknown_voucher_types),
      industry:              typeof body.industry === 'string' ? body.industry.slice(0, 64) : null,
      files_loaded:          Math.max(0, Number(body.files_loaded) || 0),
    });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
