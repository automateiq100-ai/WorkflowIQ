import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import AppProvider from '../components/AppProvider';
import Shell from '../components/Shell';

export default async function AccountingIQPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  return (
    <AppProvider>
      <Shell user={{ name: user.user_metadata?.full_name ?? null, email: user.email ?? null, image: user.user_metadata?.avatar_url ?? null }} />
    </AppProvider>
  );
}
