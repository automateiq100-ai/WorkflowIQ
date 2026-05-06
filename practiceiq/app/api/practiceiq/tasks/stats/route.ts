/**
 * Aggregated dashboard stats for the Tasks page.
 *
 * Returns the 9 counts shown on the top stat tiles:
 *   due_today, due_tomorrow, due_in_7_days, due_after_7_days,
 *   overdue_le_7_days, overdue_gt_7_days, due_total,
 *   chargeable_total, non_chargeable_total
 *
 * "Open" tasks = status in ('open','processing','review'). Done tasks are
 * excluded from due/overdue counts.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getFirmContext } from '@/lib/practiceiq/auth';
import { fyDateRange } from '@/lib/practiceiq/fy';

const OPEN_STATUSES = ['open', 'processing', 'review'] as const;

export async function GET(req: Request) {
  const supabase = await createClient();
  const ctx = await getFirmContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const fy = url.searchParams.get('fy');
  const range = fy ? fyDateRange(fy) : null;

  // Pull just the columns we need. RLS already scopes to firm + permissions.
  let q = supabase
    .from('practiceiq_tasks')
    .select('id, status, due_date, chargeable, financial_year');

  if (range) {
    q = q.or(`financial_year.eq.${fy},and(due_date.gte.${range.from},due_date.lte.${range.to})`);
  }

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().slice(0, 10);
  const dayMs = 24 * 60 * 60 * 1000;
  const tomorrow = new Date(today.getTime() + dayMs);
  const in7 = new Date(today.getTime() + 7 * dayMs);
  const overdue7 = new Date(today.getTime() - 7 * dayMs);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);

  const stats = {
    due_today: 0,
    due_tomorrow: 0,
    due_in_7_days: 0,       // due in (today, today+7] excluding today + tomorrow
    due_after_7_days: 0,    // due > today+7
    overdue_le_7_days: 0,   // due >= today-7 and due < today
    overdue_gt_7_days: 0,   // due < today-7
    due_total: 0,           // any open task with a due_date >= today
    chargeable_total: 0,
    non_chargeable_total: 0,
  };

  for (const r of data ?? []) {
    const isOpen = (OPEN_STATUSES as readonly string[]).includes(r.status);
    if (!isOpen) continue;

    if (r.chargeable) stats.chargeable_total += 1;
    else stats.non_chargeable_total += 1;

    if (!r.due_date) continue;
    const due = new Date(r.due_date + 'T00:00:00');

    if (r.due_date === todayStr) stats.due_today += 1;
    else if (r.due_date === tomorrowStr) stats.due_tomorrow += 1;
    else if (due > tomorrow && due <= in7) stats.due_in_7_days += 1;
    else if (due > in7) stats.due_after_7_days += 1;
    else if (due < today && due >= overdue7) stats.overdue_le_7_days += 1;
    else if (due < overdue7) stats.overdue_gt_7_days += 1;

    if (due >= today) stats.due_total += 1;
  }

  return NextResponse.json({ data: stats });
}
