import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { getFirmContext } from '@/lib/practiceiq/auth';

const SETUP_TTL_MINUTES = 15;

export async function POST() {
  const supabase = await createClient();
  const ctx = await getFirmContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const token = randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + SETUP_TTL_MINUTES * 60 * 1000).toISOString();

  const { error } = await supabase
    .from('practiceiq_ca_telegram_setup')
    .insert({
      token,
      firm_id: ctx.firmId,
      created_by: ctx.userId,
      expires_at: expiresAt,
    });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const botUsername = process.env.TELEGRAM_BOT_USERNAME;
  const url = botUsername
    ? `https://t.me/${botUsername}?start=ca_${token}`
    : null;

  return NextResponse.json({
    data: {
      token,
      url,
      expires_at: expiresAt,
      bot_configured: !!botUsername,
    },
  });
}
