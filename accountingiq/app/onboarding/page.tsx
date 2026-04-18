import { createClient } from '@/lib/supabase/server';
import { createClient as createAdmin } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';

export default async function OnboardingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const admin = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
  );

  // Mark any legacy user with onboarding_done: false as done — company details
  // are now collected inside AccountingIQ's CompanySelectorView.
  await admin.from('user_profiles').update({ onboarding_done: true }).eq('id', user.id);

  redirect('/portal');
}
