'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

type SubItem = { href: string; label: string };
type NavItem = { href: string; label: string; icon: string; subItems?: SubItem[] };

const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: '🏠' },
  { href: '/clients', label: 'Clients', icon: '👥' },
  { href: '/tasks', label: 'Tasks', icon: '✅' },
  { href: '/tasks/recurring', label: 'Recurring', icon: '🔁' },
  { href: '/calendar', label: 'Calendar', icon: '📅' },
  {
    href: '/documents',
    label: 'Documents',
    icon: '📁',
    subItems: [
      { href: '/documents', label: 'Inbox' },
      { href: '/documents/follow-up', label: 'Follow-up Queue' },
      { href: '/documents/ask-shalini', label: 'Ask Shalini' },
    ],
  },
  { href: '/invoices', label: 'Invoices', icon: '🧾' },
  { href: '/settings', label: 'Settings', icon: '⚙️' },
];

export default function PracticeShell({
  children,
  userEmail,
}: {
  children: React.ReactNode;
  userEmail: string;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
  }

  function isActive(href: string, exact: boolean) {
    if (exact) return pathname === href;
    return pathname?.startsWith(href);
  }

  return (
    <div className="min-h-screen flex" style={{ background: 'var(--bg)' }}>
      {/* Sidebar */}
      <aside
        className="w-60 shrink-0 border-r flex flex-col"
        style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
      >
        <div className="px-5 py-5 border-b" style={{ borderColor: 'var(--border)' }}>
          {/* Plain anchor to bypass basePath and link to the main portal */}
          <a href="/portal" className="block">
            <div
              className="text-base"
              style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}
            >
              PracticeIQ
            </div>
            <div className="text-xs" style={{ color: 'var(--purple)' }}>
              CA Practice Management
            </div>
          </a>
        </div>

        <nav className="flex-1 py-3">
          {NAV.map(item => {
            const exact = item.href === '/dashboard';
            const active = isActive(item.href, exact);
            const expanded = !!item.subItems && pathname?.startsWith(item.href);
            return (
              <div key={item.href}>
                <Link
                  href={item.href}
                  className="flex items-center gap-3 px-5 py-2 text-sm transition-colors"
                  style={{
                    color: active ? 'var(--text1)' : 'var(--text2)',
                    background: active && !expanded ? 'var(--bg3)' : 'transparent',
                    borderLeft: `3px solid ${active ? 'var(--purple)' : 'transparent'}`,
                  }}
                >
                  <span>{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
                {expanded && item.subItems && (
                  <div>
                    {item.subItems.map(sub => {
                      const subActive = pathname === sub.href;
                      return (
                        <Link
                          key={sub.href}
                          href={sub.href}
                          className="flex items-center gap-3 pl-12 pr-5 py-1.5 text-sm transition-colors"
                          style={{
                            color: subActive ? 'var(--text1)' : 'var(--text3)',
                            background: subActive ? 'var(--bg3)' : 'transparent',
                            borderLeft: `3px solid ${subActive ? 'var(--purple)' : 'transparent'}`,
                          }}
                        >
                          {sub.label}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div
          className="px-5 py-3 border-t text-xs"
          style={{ borderColor: 'var(--border)', color: 'var(--text3)' }}
        >
          <div className="truncate mb-2" title={userEmail}>{userEmail}</div>
          <div className="flex gap-3">
            <a href="/portal" style={{ color: 'var(--text2)' }}>← Portal</a>
            <button onClick={signOut} style={{ color: 'var(--text3)' }}>Sign out</button>
          </div>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
