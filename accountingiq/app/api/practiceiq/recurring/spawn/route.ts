import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { nextOccurrence, periodKey, toIsoDate } from '@/lib/practiceiq/recurring-engine';
import type { RecurringTemplate } from '@/lib/practiceiq/types';

/**
 * For each active template, compute its next occurrence relative to today
 * and create a Task for it (if one doesn't already exist for that period).
 */
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: templates, error } = await supabase
    .from('practiceiq_recurring_templates')
    .select('*')
    .eq('active', true);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const today = new Date();
  const created: string[] = [];
  const skipped: string[] = [];

  for (const t of (templates ?? []) as RecurringTemplate[]) {
    const next = nextOccurrence(t, today);
    const period = periodKey(next, t.cadence);

    if (t.last_spawned_for === period) {
      skipped.push(t.id);
      continue;
    }

    const { data: task, error: insErr } = await supabase
      .from('practiceiq_tasks')
      .insert({
        owner_user_id: user.id,
        client_id: t.client_id,
        title: `${t.title} — ${period}`,
        status: 'open',
        priority: 'normal',
        due_date: toIsoDate(next),
        assigned_to: t.assigned_to,
        fee_amount: t.fee_amount,
        recurring_template_id: t.id,
      })
      .select('id')
      .single();

    if (insErr) continue;

    await supabase
      .from('practiceiq_recurring_templates')
      .update({ last_spawned_for: period })
      .eq('id', t.id);

    if (task) created.push(task.id);
  }

  return NextResponse.json({ created: created.length, skipped: skipped.length });
}
