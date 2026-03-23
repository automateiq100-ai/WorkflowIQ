import { createClient } from '@/lib/supabase/server';
import AppProvider from './components/AppProvider';
import Shell from './components/Shell';

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <AppProvider>
      <Shell user={user ? { name: user.user_metadata?.full_name ?? null, email: user.email ?? null, image: user.user_metadata?.avatar_url ?? null } : null} />
    </AppProvider>
  );
}
