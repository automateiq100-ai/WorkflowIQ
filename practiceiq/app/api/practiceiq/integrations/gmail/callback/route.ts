import { NextResponse } from 'next/server';
import { createClient as createServerSupabase } from '@/lib/supabase/server';
import { createClient as createServiceSupabase } from '@supabase/supabase-js';
import { getFirmContext } from '@/lib/practiceiq/auth';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

function settingsRedirect(success: boolean, msg?: string): Response {
  const u = new URL('/practiceiq/settings', process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000');
  u.searchParams.set('gmail', success ? 'connected' : 'error');
  if (msg) u.searchParams.set('msg', msg);
  return NextResponse.redirect(u.toString());
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const errParam = url.searchParams.get('error');
  if (errParam) return settingsRedirect(false, errParam);
  if (!code || !state) return settingsRedirect(false, 'missing_code_or_state');

  // Re-verify the user belongs to the firm encoded in `state`.
  const supabase = await createServerSupabase();
  const ctx = await getFirmContext(supabase);
  if (!ctx || ctx.firmId !== state) return settingsRedirect(false, 'session_mismatch');

  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const redirectUri = process.env.GMAIL_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    return settingsRedirect(false, 'env_missing');
  }

  // Exchange code for tokens.
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });

  let tokenJson: { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string } = {};
  try {
    const r = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    tokenJson = await r.json();
    if (!r.ok || tokenJson.error) {
      return settingsRedirect(false, tokenJson.error || 'token_exchange_failed');
    }
  } catch {
    return settingsRedirect(false, 'token_exchange_network');
  }

  if (!tokenJson.refresh_token) {
    // Re-consent should always issue one (we passed prompt=consent), but guard anyway.
    return settingsRedirect(false, 'no_refresh_token');
  }

  // Fetch the connected email address.
  let email = '';
  try {
    const u = await fetch(USERINFO_URL, {
      headers: { authorization: `Bearer ${tokenJson.access_token}` },
    });
    const j = await u.json();
    email = j.email || '';
  } catch { /* ignore */ }

  // Persist via service role (RLS on this table only allows owner-select).
  const serviceUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!serviceUrl || !serviceKey) return settingsRedirect(false, 'service_key_missing');
  const admin = createServiceSupabase(serviceUrl, serviceKey, { auth: { persistSession: false } });

  const expiresAt = tokenJson.expires_in
    ? new Date(Date.now() + tokenJson.expires_in * 1000).toISOString()
    : null;

  const { error: upErr } = await admin
    .from('practiceiq_gmail_credentials')
    .upsert({
      firm_id: ctx.firmId,
      email,
      refresh_token: tokenJson.refresh_token,
      access_token: tokenJson.access_token ?? null,
      access_token_expires_at: expiresAt,
      scopes: (tokenJson.scope || '').split(' ').filter(Boolean),
      updated_at: new Date().toISOString(),
    });

  if (upErr) return settingsRedirect(false, 'persist_failed');
  return settingsRedirect(true);
}
