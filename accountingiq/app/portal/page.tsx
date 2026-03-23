import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import PortalShell from '../components/PortalShell';

export default async function PortalPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('mobile')
    .eq('id', user.id)
    .single();

  return (
    <PortalShell
      user={{
        name: user.user_metadata?.full_name ?? null,
        email: user.email ?? '',
        image: user.user_metadata?.avatar_url ?? null,
      }}
      hasMobile={!!profile?.mobile}
    />
  );
}
