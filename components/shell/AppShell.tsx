import { Topbar } from './Topbar';
import { Sidebar } from './Sidebar';
import { NAV, canSeeSettings, canSeeNavItem } from '@/lib/nav';
import { ensureRoleCache } from '@/lib/auth/access';

interface AppShellProps {
  email: string;
  name: string | null;
  /** Resolved app_role key (e.g. 'admin', 'logistics'), not the legacy enum. */
  role: string;
  children: React.ReactNode;
}

export async function AppShell({ email, name, role, children }: AppShellProps) {
  // Permission filtering MUST run server-side: the role→permission cache is a
  // server process Map, empty in the browser. Compute visible nav hrefs here
  // (cache warmed by getRole upstream) and pass the list to the client Sidebar,
  // which only needs usePathname for the reactive active-highlight.
  await ensureRoleCache();
  const visibleHrefs = NAV
    .filter((item) => (item.href === '/settings' ? canSeeSettings(role) : canSeeNavItem(role, item.requires)))
    .map((item) => item.href);

  // The shell is pinned to the viewport: topbar and sidebar never scroll.
  // Only <main> scrolls vertically, so any in-page sticky (matrix thead,
  // future toolbars) anchors below the topbar instead of inside the page body.
  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <Topbar email={email} name={name} role={role} />
      <div className="flex flex-1 min-h-0">
        <Sidebar visibleHrefs={visibleHrefs} />
        <main className="flex-1 min-w-0 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
