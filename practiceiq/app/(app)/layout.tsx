import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import PracticeShell from '@/components/PracticeShell';
import { getFirmContext } from '@/lib/practiceiq/auth';
import { getPermissionMap } from '@/lib/practiceiq/permissions';
import { ALL_PERMISSION_MODULES } from '@/lib/practiceiq/types';
import type { PermissionMap } from '@/lib/practiceiq/types';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    // Redirect to the WorkflowIQ portal login (one credential surface for the
    // whole platform). Use an absolute URL to escape this app's basePath.
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    const h = await headers();
    // Best-effort: capture the path the user tried to reach so the portal
    // can bounce them back here after they sign in. The bare basePath root
    // (`/practiceiq`) is not itself a route, so default to /dashboard.
    let incomingPath =
      h.get('x-invoke-path') ||
      h.get('next-url') ||
      '/practiceiq/dashboard';
    if (incomingPath === '/practiceiq' || incomingPath === '/') {
      incomingPath = '/practiceiq/dashboard';
    }
    if (!incomingPath.startsWith('/practiceiq')) {
      incomingPath = '/practiceiq/dashboard';
    }
    const next = encodeURIComponent(incomingPath);
    redirect(`${siteUrl}/login?next=${next}`);
  }

  // Resolve firm context (auto-bootstraps a firm on first sign-in).
  const ctx = await getFirmContext(supabase);

  // Resolve module permissions for nav rendering. Fallback: empty map (UI
  // layer treats missing perms as "no access" so nav items hide gracefully).
  let permissions: PermissionMap;
  if (ctx) {
    permissions = await getPermissionMap(supabase, ctx);
  } else {
    permissions = ALL_PERMISSION_MODULES.reduce((acc, m) => {
      acc[m] = { can_read: false, can_write: false };
      return acc;
    }, {} as PermissionMap);
  }

  return (
    <PracticeShell
      userEmail={user.email ?? ''}
      role={ctx?.role ?? 'staff'}
      permissions={permissions}
    >
      {children}
    </PracticeShell>
  );
}
