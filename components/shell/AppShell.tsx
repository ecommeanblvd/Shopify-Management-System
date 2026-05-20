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
  return (
    <div className="min-h-screen flex flex-col">
      <Topbar email={email} name={name} role={role} />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar role={role} currentPath={currentPath} />
        <main className="flex-1 overflow-auto">
          <div className="p-6 mx-auto max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
