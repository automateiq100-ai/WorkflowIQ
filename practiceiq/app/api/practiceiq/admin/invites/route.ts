import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { getFirmContext } from '@/lib/practiceiq/auth';

const INVITE_TTL_DAYS = 14;
const VALID_ROLES = new Set(['admin', 'dept_head', 'staff', 'hr_admin']);

export async function GET() {
  const supabase = await createClient();
  const ctx = await getFirmContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (ctx.role !== 'admin') {
    return NextResponse.json({ error: 'admin only' }, { status: 403 });
  }

  const { data, error } = await supabase
    .from('practiceiq_firm_invites')
    .select('*')
    .eq('firm_id', ctx.firmId)
    .is('consumed_at', null)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const ctx = await getFirmContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (ctx.role !== 'admin') {
    return NextResponse.json({ error: 'admin only' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const email = (typeof body.email === 'string' ? body.email.trim().toLowerCase() : '');
  const role = typeof body.role === 'string' ? body.role : 'staff';
  const departmentId = body.department_id ?? null;

  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'valid email required' }, { status: 400 });
  }
  if (!VALID_ROLES.has(role)) {
    return NextResponse.json({ error: 'invalid role' }, { status: 400 });
  }

  const token = randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: invite, error } = await supabase
    .from('practiceiq_firm_invites')
    .insert({
      token,
      firm_id: ctx.firmId,
      email,
      role,
      department_id: departmentId,
      created_by: ctx.userId,
      expires_at: expiresAt,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Best-effort: send a magic-link invite email via Supabase admin API. The
  // user's first sign-in via that link auto-claims this invite (see auth.ts
  // bootstrap path).
  let emailSent = false;
  let emailError: string | null = null;
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_KEY;
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    if (url && serviceKey) {
      const admin = createServiceClient(url, serviceKey, { auth: { persistSession: false } });
      const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${siteUrl}/practiceiq/dashboard`,
      });
      if (inviteErr) {
        emailError = inviteErr.message;
      } else {
        emailSent = true;
      }
    } else {
      emailError = 'service key not configured';
    }
  } catch (e) {
    emailError = e instanceof Error ? e.message : 'invite-send failed';
  }

  return NextResponse.json({ data: { invite, email_sent: emailSent, email_error: emailError } });
}
