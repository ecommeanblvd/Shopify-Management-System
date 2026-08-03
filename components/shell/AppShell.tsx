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
  // PRINT: giấu topbar + sidebar (in trang nào cũng chỉ cần nội dung), và bỏ
  // pin viewport (h-screen + overflow-hidden làm bản in bị cắt còn 1 trang).
  return (
    <div className="h-screen flex flex-col overflow-hidden print:h-auto print:overflow-visible print:block">
      <div className="contents print:hidden">
        <Topbar email={email} name={name} role={role} />
      </div>
      <div className="flex flex-1 min-h-0 print:block print:min-h-0">
        <div className="contents print:hidden">
          <Sidebar visibleHrefs={visibleHrefs} />
        </div>
        <main className="flex-1 min-w-0 overflow-auto print:overflow-visible">
          {children}
        </main>
      </div>
    </div>
  );
}
