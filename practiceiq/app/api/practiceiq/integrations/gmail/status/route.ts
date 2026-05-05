import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // RLS allows owner SELECT — but only of email/connected_at columns; refresh_token never reaches client.
  const { data, error } = await supabase
    .from('practiceiq_gmail_credentials')
    .select('email, connected_at, last_history_id')
    .eq('owner_user_id', user.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data ?? null });
}
