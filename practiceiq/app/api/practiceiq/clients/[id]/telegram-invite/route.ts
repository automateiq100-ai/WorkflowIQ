import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';

const INVITE_TTL_DAYS = 7;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: clientId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const label: string | null = typeof body.label === 'string' ? body.label : null;

  const token = randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('practiceiq_telegram_invites')
    .insert({
      token,
      client_id: clientId,
      owner_user_id: user.id,
      created_by: user.id,
      label,
      expires_at: expiresAt,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const botUsername = process.env.TELEGRAM_BOT_USERNAME;
  const url = botUsername
    ? `https://t.me/${botUsername}?start=invite_${token}`
    : null;

  return NextResponse.json({
    data: {
      token: data.token,
      url,
      expires_at: data.expires_at,
      bot_configured: !!botUsername,
    },
  });
}
