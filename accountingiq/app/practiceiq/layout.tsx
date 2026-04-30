import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import PracticeShell from '../components/practiceiq/PracticeShell';

export default async function PracticeLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  return (
    <PracticeShell userEmail={user.email ?? ''}>
      {children}
    </PracticeShell>
  );
}
