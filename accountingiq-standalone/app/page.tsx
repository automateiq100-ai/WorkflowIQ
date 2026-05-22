import { createClient } from '@/lib/supabase/server';
import { createClient as createAdmin } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import AppProvider from './components/AppProvider';
import Shell from './components/Shell';

export default async function Home() {
  // Local dev bypass — skip auth so you can test without a Supabase session.
  // Do NOT set DEV_BYPASS_AUTH in production.
  if (process.env.DEV_BYPASS_AUTH === 'true') {
    return (
      <AppProvider>
        <Shell user={{ name: 'Dev User', email: 'dev@localhost', image: null }} />
      </AppProvider>
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  // Ensure a profile row exists for this user (handles the case where email
  // confirmation is disabled and the auth/callback bootstrap never ran).
  const admin = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
  );
  await admin.from('accountingiq_users').upsert({
    id: user.id,
    email: user.email,
    full_name: user.user_metadata?.full_name ?? null,
    mobile: user.user_metadata?.mobile ?? null,
    last_seen: new Date().toISOString(),
  }, { onConflict: 'id' });

  return (
    <AppProvider>
      <Shell user={{ name: user.user_metadata?.full_name ?? null, email: user.email ?? null, image: null }} />
    </AppProvider>
  );
}
