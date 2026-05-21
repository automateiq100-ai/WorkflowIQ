/**
 * /api/master/ledger-overrides
 *
 * Per-company classification overrides backed by the
 * `accountingiq_ledger_overrides` table.  Replaces the localStorage path
 * for production multi-device / multi-user-per-company use cases.
 *
 *   GET  ?company_id=…              → list all overrides for a company
 *   PUT  body { company_id, overrides[] }  → upsert a batch
 *   DELETE ?company_id=…&ledger=…   → remove a single override (revert to auto)
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

/** Verify the caller actually owns the company they're acting on.  Defends
 *  against API misuse since we use the service role for the actual
 *  read/write to bypass RLS for performance. */
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

export async function GET(request: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const companyId = request.nextUrl.searchParams.get('company_id');
  if (!companyId) return NextResponse.json({ error: 'company_id required' }, { status: 400 });
  if (!(await ownsCompany(user.id, companyId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const admin = adminClient();
  const { data, error } = await admin
    .from('accountingiq_ledger_overrides')
    .select('ledger_name, category, primary_group, source, updated_at')
    .eq('company_id', companyId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Return in the LedgerOverride shape the client expects.
  const overrides = (data ?? []).map(row => ({
    ledgerName: row.ledger_name,
    category: row.category,
    primaryGroup: row.primary_group ?? undefined,
    source: row.source as 'user-edited' | 'auto-confirmed',
    updatedAt: row.updated_at,
  }));
  return NextResponse.json({ overrides });
}

export async function PUT(request: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const companyId = body?.company_id;
  const overrides: Array<{ ledgerName: string; category: string; primaryGroup?: string; source: string }> = body?.overrides ?? [];
  if (!companyId) return NextResponse.json({ error: 'company_id required' }, { status: 400 });
  if (!Array.isArray(overrides) || overrides.length === 0) {
    return NextResponse.json({ error: 'overrides[] required' }, { status: 400 });
  }
  if (!(await ownsCompany(user.id, companyId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const rows = overrides.map(o => ({
    company_id: companyId,
    ledger_name: o.ledgerName,
    category: o.category,
    primary_group: o.primaryGroup ?? null,
    source: o.source ?? 'user-edited',
    updated_at: new Date().toISOString(),
  }));

  const admin = adminClient();
  const { error } = await admin
    .from('accountingiq_ledger_overrides')
    .upsert(rows, { onConflict: 'company_id,ledger_name' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, count: rows.length });
}

export async function DELETE(request: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const companyId = request.nextUrl.searchParams.get('company_id');
  const ledger = request.nextUrl.searchParams.get('ledger');
  if (!companyId || !ledger) {
    return NextResponse.json({ error: 'company_id and ledger required' }, { status: 400 });
  }
  if (!(await ownsCompany(user.id, companyId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const admin = adminClient();
  const { error } = await admin
    .from('accountingiq_ledger_overrides')
    .delete()
    .eq('company_id', companyId)
    .eq('ledger_name', ledger);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
