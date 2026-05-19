import { createClient } from '@/lib/supabase/server';
import { createClient as createAdmin } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import PortalShell from '../components/PortalShell';

export default async function PortalPage() {
  // Local dev bypass — skip auth + profile lookup, jump straight into
  // AccountingIQ.  Mirrors the same flag in app/accountingiq/page.tsx so
  // the entry redirect chain `/ → /portal → /accountingiq` works without
  // Google OAuth.  Do NOT set DEV_BYPASS_AUTH in production.
  if (process.env.DEV_BYPASS_AUTH === 'true') {
    redirect('/accountingiq');
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const admin = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
  );
  const { data: profile } = await admin
    .from('workflowiq_clients')
    .select('onboarding_done, selected_tools')
    .eq('id', user.id)
    .single();

  if (!profile) {
    // Profile row missing (e.g. email-confirm disabled and init call lost the cookie race).
    // Bootstrap it now from auth metadata.
    await admin.from('workflowiq_clients').upsert({
      id: user.id,
      email: user.email,
      full_name: user.user_metadata?.full_name ?? null,
      mobile: user.user_metadata?.mobile ?? null,
      selected_tools: user.user_metadata?.selected_tools ?? ['accountingiq'],
      onboarding_done: true,
      last_seen: new Date().toISOString(),
    }, { onConflict: 'id' });
  } else if (!profile.onboarding_done) {
    await admin.from('workflowiq_clients').update({ onboarding_done: true }).eq('id', user.id);
  }

  const selectedTools: string[] =
    (profile?.selected_tools as string[]) ??
    (user.user_metadata?.selected_tools as string[]) ??
    ['accountingiq'];

  return (
    <PortalShell
      user={{
        name: user.user_metadata?.full_name ?? null,
        email: user.email ?? '',
        mobile: user.user_metadata?.mobile ?? null,
      }}
      selectedTools={selectedTools}
    />
  );
}
