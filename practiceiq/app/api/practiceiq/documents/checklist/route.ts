import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

type ChecklistRow = {
  id: string;
  client_id: string;
  doc_type: string;
  label: string;
  deadline_date: string;
  followup_start_date: string;
};
type StatusRow = { client_id: string; doc_type: string; status: string; received_at: string | null };
type ClientRow = { id: string; name: string; telegram_first_name: string | null };
type FollowupRow = { client_id: string; doc_type: string; sent_at: string };

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const statusFilter = url.searchParams.get('status') ?? 'pending';

  // 1. CA's clients
  const { data: clients, error: cErr } = await supabase
    .from('practiceiq_clients')
    .select('id, name, telegram_first_name')
    .eq('owner_user_id', user.id);
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });

  const clientIds = (clients as ClientRow[] | null ?? []).map(c => c.id);
  if (clientIds.length === 0) return NextResponse.json({ data: [] });

  // 2. Their checklists, statuses, follow-up history (parallel)
  const [checkRes, statusRes, fuRes] = await Promise.all([
    supabase.from('practiceiq_document_checklist').select('*').in('client_id', clientIds),
    supabase.from('practiceiq_document_status').select('client_id, doc_type, status, received_at').in('client_id', clientIds),
    supabase.from('practiceiq_followup_log').select('client_id, doc_type, sent_at').in('client_id', clientIds).order('sent_at', { ascending: false }),
  ]);

  if (checkRes.error) return NextResponse.json({ error: checkRes.error.message }, { status: 500 });
  if (statusRes.error) return NextResponse.json({ error: statusRes.error.message }, { status: 500 });
  if (fuRes.error) return NextResponse.json({ error: fuRes.error.message }, { status: 500 });

  const clientById = new Map((clients as ClientRow[]).map(c => [c.id, c]));
  const statusByKey = new Map<string, StatusRow>(
    ((statusRes.data ?? []) as StatusRow[]).map(s => [`${s.client_id}:${s.doc_type}`, s])
  );

  // Latest follow-up per (client, doc_type) + count
  const fuLatest = new Map<string, string>();
  const fuCount = new Map<string, number>();
  for (const f of (fuRes.data ?? []) as FollowupRow[]) {
    const k = `${f.client_id}:${f.doc_type}`;
    if (!fuLatest.has(k)) fuLatest.set(k, f.sent_at);
    fuCount.set(k, (fuCount.get(k) ?? 0) + 1);
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const rows = ((checkRes.data ?? []) as ChecklistRow[]).flatMap(chk => {
    const k = `${chk.client_id}:${chk.doc_type}`;
    const s = statusByKey.get(k);
    const status = s?.status ?? 'pending';
    if (statusFilter && status !== statusFilter) return [];
    const client = clientById.get(chk.client_id);
    if (!client) return [];
    const deadline = new Date(chk.deadline_date);
    const days = Math.floor((deadline.getTime() - today.getTime()) / 86_400_000);
    return [{
      client_id: chk.client_id,
      client_name: client.name,
      telegram_first_name: client.telegram_first_name,
      doc_type: chk.doc_type,
      label: chk.label,
      deadline_date: chk.deadline_date,
      followup_start_date: chk.followup_start_date,
      days_to_deadline: days,
      last_followup_at: fuLatest.get(k) ?? null,
      followup_count: fuCount.get(k) ?? 0,
    }];
  }).sort((a, b) => a.days_to_deadline - b.days_to_deadline);

  return NextResponse.json({ data: rows });
}
