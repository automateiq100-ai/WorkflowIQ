import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import PracticeShell from '@/components/PracticeShell';
import { getFirmContext } from '@/lib/practiceiq/auth';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Resolve firm context (auto-bootstraps a firm on first sign-in).
  const ctx = await getFirmContext(supabase);

  return (
    <PracticeShell userEmail={user.email ?? ''} role={ctx?.role ?? 'staff'}>
      {children}
    </PracticeShell>
  );
}
