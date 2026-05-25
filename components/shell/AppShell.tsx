import { headers } from 'next/headers';
import { Topbar } from './Topbar';
import { Sidebar } from './Sidebar';
import type { Role } from '@/lib/auth/rbac';

interface AppShellProps {
  email: string;
  name: string | null;
  role: Role;
  children: React.ReactNode;
}

export async function AppShell({ email, name, role, children }: AppShellProps) {
  const hdrs = await headers();
  const currentPath = hdrs.get('x-pathname') ?? '/';
  // The shell is pinned to the viewport: topbar and sidebar never scroll.
  // Only <main> scrolls vertically, so any in-page sticky (matrix thead,
  // future toolbars) anchors below the topbar instead of inside the page body.
  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <Topbar email={email} name={name} role={role} />
      <div className="flex flex-1 min-h-0">
        <Sidebar role={role} currentPath={currentPath} />
        <main className="flex-1 min-w-0 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
