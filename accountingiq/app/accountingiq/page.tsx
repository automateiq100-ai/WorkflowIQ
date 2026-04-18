import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import AppProvider from '../components/AppProvider';
import Shell from '../components/Shell';

export default async function AccountingIQPage() {
  // Local dev bypass — skip auth so you can test without Google OAuth
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

  return (
    <AppProvider>
      <Shell user={{ name: user.user_metadata?.full_name ?? null, email: user.email ?? null, image: null }} />
    </AppProvider>
  );
}
