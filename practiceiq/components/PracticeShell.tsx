'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { FirmRole, PermissionMap, PermissionModule } from '@/lib/practiceiq/types';

type SubItem = { href: string; label: string };
type NavItem = {
  href: string;
  label: string;
  icon: string;
  subItems?: SubItem[];
  module: PermissionModule;
  /** when true, only render if requester has admin role (not just module perm) */
  adminOnly?: boolean;
};

const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: '🏠', module: 'dashboard' },
  { href: '/clients',   label: 'Clients',   icon: '👥', module: 'clients' },
  { href: '/services',  label: 'Services',  icon: '🛠️', module: 'services' },
  { href: '/calendar',  label: 'Calendar',  icon: '📅', module: 'calendar' },
  { href: '/tasks',     label: 'Task',      icon: '📋', module: 'tasks' },
  {
    href: '/documents',
    label: 'Documents',
    icon: '📁',
    module: 'documents',
    subItems: [
      { href: '/documents', label: 'Inbox' },
      { href: '/documents/follow-up', label: 'Follow-up Queue' },
      { href: '/documents/ask-shalini', label: 'Ask Shalini' },
    ],
  },
  {
    href: '/hrms',
    label: 'HRMS',
    icon: '👤',
    module: 'hrms',
    subItems: [
      { href: '/hrms', label: 'View Employee' },
      { href: '/hrms/hierarchy', label: 'Employee Hierarchy' },
      { href: '/hrms/leave', label: 'My Leave' },
      { href: '/hrms/attendance', label: 'My Attendance' },
      { href: '/hrms/expense', label: 'My Expense' },
      { href: '/hrms/approvals', label: 'Manager Approval' },
      { href: '/hrms/reports', label: 'Manager Reports' },
      { href: '/hrms/timesheet', label: 'Timesheet' },
    ],
  },
  { href: '/settings', label: 'Settings', icon: '⚙️', module: 'admin' },
  {
    href: '/admin/firm',
    label: 'Admin',
    icon: '🛡️',
    module: 'admin',
    adminOnly: true,
    subItems: [
      { href: '/admin/firm', label: 'Firm details' },
      { href: '/admin/users', label: 'Team' },
      { href: '/admin/roles', label: 'Roles & Permissions' },
    ],
  },
];

type AttendanceState = { check_in_at: string | null; check_out_at: string | null } | null;
type Theme = 'dark' | 'light';

const SIDEBAR_WIDTH_EXPANDED = 240;
const SIDEBAR_WIDTH_COLLAPSED = 64;

export default function PracticeShell({
  children,
  userEmail,
  role,
  permissions,
}: {
  children: React.ReactNode;
  userEmail: string;
  role: FirmRole;
  permissions: PermissionMap;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [now, setNow] = useState<Date>(new Date());
  const [attendance, setAttendance] = useState<AttendanceState>(null);

  // Sidebar state.
  // - `collapsed` = desktop icon-only mode (toggle persists in localStorage).
  // - `mobileOpen` = drawer state on small screens (off-canvas).
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const [mobileOpen, setMobileOpen] = useState<boolean>(false);

  // Theme — toggles `html.light` per globals.css. Persisted in localStorage.
  const [theme, setTheme] = useState<Theme>('dark');

  // Restore persisted state on mount.
  useEffect(() => {
    try {
      if (window.localStorage.getItem('practiceiq:sidebar:collapsed') === '1') setCollapsed(true);
      const t = window.localStorage.getItem('practiceiq:theme') as Theme | null;
      if (t === 'light' || t === 'dark') {
        setTheme(t);
      } else if (window.matchMedia?.('(prefers-color-scheme: light)').matches) {
        setTheme('light');
      }
    } catch {}
  }, []);

  // Sync theme to <html> class so the CSS variables in globals.css flip.
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'light') root.classList.add('light');
    else root.classList.remove('light');
  }, [theme]);

  // Auto-close the mobile drawer on route change.
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  // Live clock for the top bar.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000 * 30);
    return () => clearInterval(id);
  }, []);

  // Pull today's attendance row once on mount.
  useEffect(() => {
    let cancelled = false;
    fetch('/practiceiq/api/practiceiq/hrms/attendance/today')
      .then(r => r.ok ? r.json() : { data: null })
      .then(j => { if (!cancelled) setAttendance(j.data ?? null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
  }

  function isActive(href: string, exact: boolean) {
    if (exact) return pathname === href;
    return pathname?.startsWith(href);
  }

  async function handleCheck(action: 'check-in' | 'check-out') {
    const res = await fetch(`/practiceiq/api/practiceiq/hrms/attendance/${action}`, { method: 'POST' });
    if (res.ok) {
      const j = await res.json();
      setAttendance(j.data ?? null);
    }
  }

  function toggleCollapsed() {
    setCollapsed(c => {
      const next = !c;
      try { window.localStorage.setItem('practiceiq:sidebar:collapsed', next ? '1' : '0'); } catch {}
      return next;
    });
  }

  function toggleTheme() {
    setTheme(t => {
      const next: Theme = t === 'dark' ? 'light' : 'dark';
      try { window.localStorage.setItem('practiceiq:theme', next); } catch {}
      return next;
    });
  }

  // Filter nav: respect can_read on the module, plus adminOnly hard-gate.
  const visibleNav = NAV.filter(item => {
    if (item.adminOnly && role !== 'admin') return false;
    return permissions[item.module]?.can_read;
  });

  const checkedIn = !!attendance?.check_in_at && !attendance?.check_out_at;
  const checkLabel = checkedIn ? 'Check Out' : 'Check In';
  const checkColor = checkedIn ? 'var(--coral)' : 'var(--teal)';
  const clockText = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const desktopSidebarWidth = collapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED;

  // CSS-driven responsive layout:
  //   - On mobile (<768px) the sidebar is always 240px and slides off-canvas
  //     when `mobileOpen` is false. Main content has zero left margin.
  //   - On desktop (≥768px) the sidebar's width tracks `desktopSidebarWidth`
  //     and main content's left margin matches it. We apply the dynamic px
  //     value through an inline <style> block keyed on `.practiceiq-aside`
  //     and `.practiceiq-main` because Tailwind can't take a JS-computed
  //     pixel value scoped to a media query.
  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
      <style>{`
        @media (min-width: 768px) {
          .practiceiq-aside { width: ${desktopSidebarWidth}px !important; }
          .practiceiq-main  { margin-left: ${desktopSidebarWidth}px; }
        }
      `}</style>

      {/* Mobile backdrop — only renders when the mobile drawer is open. The
          md:hidden class makes sure it never paints on desktop, even if state
          got stuck somehow. */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-30 md:hidden"
          style={{ background: 'rgba(0,0,0,0.55)' }}
          aria-hidden
        />
      )}

      {/* Sidebar — fixed-position so it always fills the viewport height. */}
      <aside
        className={[
          'practiceiq-aside fixed top-0 left-0 z-40 border-r flex flex-col',
          'transition-transform duration-200 ease-out',
          // Mobile: off-canvas by default, slides in when mobileOpen.
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          // Desktop: always visible (overrides the mobile transform).
          'md:translate-x-0',
        ].join(' ')}
        style={{
          // Default width = expanded (used on mobile); the <style> block above
          // overrides it on desktop with `desktopSidebarWidth`.
          width: SIDEBAR_WIDTH_EXPANDED,
          height: '100vh',
          background: 'var(--bg2)',
          borderColor: 'var(--border)',
        }}
      >
        {/* Header — logo links to in-app dashboard (cross-app "Portal" link
            lives in the footer to avoid a duplicate). */}
        <div
          className="border-b flex items-center justify-between"
          style={{ borderColor: 'var(--border)', padding: collapsed ? '14px 8px' : '14px 16px' }}
        >
          <Link href="/dashboard" className="block min-w-0 flex-1 truncate" title="PracticeIQ home">
            {collapsed ? (
              <div
                className="text-xl text-center"
                style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}
              >
                P
              </div>
            ) : (
              <>
                <div
                  className="text-base truncate"
                  style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}
                >
                  PracticeIQ
                </div>
                <div className="text-xs truncate" style={{ color: 'var(--purple)' }}>
                  CA Practice Management
                </div>
              </>
            )}
          </Link>
          {/* Mobile-only close (✕) — desktop has its single collapse toggle in the top bar. */}
          <button
            onClick={() => setMobileOpen(false)}
            className="md:hidden inline-flex items-center justify-center rounded shrink-0"
            style={{ width: 28, height: 28, color: 'var(--text2)', background: 'var(--bg3)' }}
            aria-label="Close menu"
          >
            ✕
          </button>
        </div>

        {/* Nav scroll area */}
        <nav className="flex-1 py-3 overflow-y-auto min-h-0">
          {visibleNav.map(item => {
            const exact = item.href === '/dashboard';
            const active = isActive(item.href, exact);
            const expanded = !collapsed && !!item.subItems && pathname?.startsWith(item.href);
            return (
              <div key={item.href}>
                <Link
                  href={item.href}
                  title={collapsed ? item.label : undefined}
                  className="flex items-center gap-3 text-sm transition-colors"
                  style={{
                    color: active ? 'var(--text1)' : 'var(--text2)',
                    background: active && !expanded ? 'var(--bg3)' : 'transparent',
                    borderLeft: `3px solid ${active ? 'var(--purple)' : 'transparent'}`,
                    padding: collapsed ? '10px 0' : '8px 16px',
                    justifyContent: collapsed ? 'center' : 'flex-start',
                  }}
                >
                  <span style={{ fontSize: collapsed ? 18 : undefined }}>{item.icon}</span>
                  {!collapsed && <span className="truncate">{item.label}</span>}
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

        {/* Footer — single "← Portal" link for cross-app navigation, plus
            sign-out. Pinned to the bottom of the sidebar (which is itself
            pinned to the viewport). shrink-0 keeps it from being squeezed. */}
        <div
          className="border-t text-xs shrink-0"
          style={{
            borderColor: 'var(--border)',
            color: 'var(--text3)',
            padding: collapsed ? '10px 8px' : '12px 16px',
          }}
        >
          {collapsed ? (
            <div className="flex flex-col items-center gap-3">
              {/* Plain anchor escapes the basePath and goes to /portal */}
              <a href="/portal" title="Back to Portal" style={{ color: 'var(--text2)', fontSize: 16 }} aria-label="Portal">⌂</a>
              <button onClick={signOut} title="Sign out" style={{ color: 'var(--text3)', fontSize: 16 }} aria-label="Sign out">⏏</button>
            </div>
          ) : (
            <>
              <div className="truncate mb-2" title={userEmail}>{userEmail}</div>
              <div className="flex justify-between items-center gap-3">
                <a href="/portal" className="truncate" style={{ color: 'var(--text2)' }}>← Portal</a>
                <button onClick={signOut} className="truncate" style={{ color: 'var(--text3)' }}>Sign out</button>
              </div>
            </>
          )}
        </div>
      </aside>

      {/* Main content — left margin matches the sidebar width on desktop. */}
      <main className="practiceiq-main min-h-screen flex flex-col">
        {/* Top bar — single collapse toggle (desktop) / hamburger (mobile),
            theme switcher, plus check-in/out + clock for HRMS users.
            Sticky so it stays visible while scrolling long pages. */}
        <div
          className="sticky top-0 z-20 flex items-center gap-2 px-3 sm:px-4 py-2 border-b text-sm"
          style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
        >
          {/* Mobile: hamburger opens the drawer */}
          <button
            onClick={() => setMobileOpen(true)}
            className="md:hidden inline-flex items-center justify-center rounded"
            style={{ width: 32, height: 32, background: 'var(--bg3)', color: 'var(--text1)' }}
            aria-label="Open menu"
          >
            ☰
          </button>
          {/* Desktop: single collapse toggle (the duplicate inside the sidebar header is removed) */}
          <button
            onClick={toggleCollapsed}
            className="hidden md:inline-flex items-center justify-center rounded"
            style={{ width: 28, height: 28, background: 'var(--bg3)', color: 'var(--text2)' }}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? '›' : '‹'}
          </button>

          <div className="flex-1" />

          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className="inline-flex items-center justify-center rounded"
            style={{ width: 32, height: 32, background: 'var(--bg3)', color: 'var(--text2)' }}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>

          {permissions.hrms?.can_read && (
            <>
              <button
                onClick={() => handleCheck(checkedIn ? 'check-out' : 'check-in')}
                className="rounded-md px-3 py-1 text-xs font-semibold whitespace-nowrap"
                style={{ background: checkColor, color: '#0e0f11' }}
              >
                {checkLabel}
              </button>
              <span className="hidden sm:inline" style={{ color: 'var(--text2)' }}>{clockText}</span>
            </>
          )}
        </div>
        {children}
      </main>
    </div>
  );
}
