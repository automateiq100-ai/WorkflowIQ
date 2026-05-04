import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { buildDeliverables, type Deliverable } from '@/lib/practiceiq/deliverables';
import type { Cadence } from '@/lib/practiceiq/types';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const fromStr = url.searchParams.get('from');
  const toStr = url.searchParams.get('to');
  if (!fromStr || !toStr || !ISO_DATE.test(fromStr) || !ISO_DATE.test(toStr)) {
    return NextResponse.json({ error: 'from and to query params required (YYYY-MM-DD)' }, { status: 400 });
  }
  const from = new Date(fromStr + 'T00:00:00');
  const to = new Date(toStr + 'T23:59:59');
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
    return NextResponse.json({ error: 'invalid date range' }, { status: 400 });
  }

  const { data: rows, error } = await supabase
    .from('practiceiq_client_services')
    .select('service, cadence, deadline_day, deadline_month, followup_lead_days, client_id, practiceiq_clients!inner(name)')
    .eq('active', true)
    .eq('owner_user_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const deliverables: Deliverable[] = [];
  for (const r of rows ?? []) {
    const joined = (r as unknown as { practiceiq_clients: { name: string } | { name: string }[] }).practiceiq_clients;
    const clientName = Array.isArray(joined) ? (joined[0]?.name ?? '') : joined.name;
    const projected = buildDeliverables(
      {
        service: r.service,
        cadence: r.cadence as Cadence,
        deadline_day: r.deadline_day,
        deadline_month: r.deadline_month,
        followup_lead_days: r.followup_lead_days,
        client_id: r.client_id,
        client_name: clientName,
      },
      from,
      to,
    );
    deliverables.push(...projected);
  }

  return NextResponse.json({ data: deliverables });
}
