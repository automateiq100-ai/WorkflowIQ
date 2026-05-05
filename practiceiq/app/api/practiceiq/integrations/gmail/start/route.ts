import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const GMAIL_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const clientId = process.env.GMAIL_CLIENT_ID;
  const redirectUri = process.env.GMAIL_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { error: 'GMAIL_CLIENT_ID and GMAIL_REDIRECT_URI must be set' },
      { status: 500 },
    );
  }

  const url = new URL(GMAIL_AUTH);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPES.join(' '));
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');           // force refresh_token issuance
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('state', user.id);              // bind to the requesting CA

  return NextResponse.redirect(url.toString());
}
