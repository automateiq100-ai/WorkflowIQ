import { NextResponse } from 'next/server';
import { createClient as createServerSupabase } from '@/lib/supabase/server';
import { createClient as createServiceSupabase } from '@supabase/supabase-js';

export async function POST() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const serviceUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!serviceUrl || !serviceKey) {
    return NextResponse.json({ error: 'service key not configured' }, { status: 500 });
  }
  const admin = createServiceSupabase(serviceUrl, serviceKey, { auth: { persistSession: false } });

  const { error } = await admin
    .from('practiceiq_gmail_credentials')
    .delete()
    .eq('owner_user_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
