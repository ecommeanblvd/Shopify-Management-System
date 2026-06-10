import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getRoleInfo } from '@/lib/auth/role';
import { AppShell } from '@/components/shell/AppShell';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');

  // getRoleInfo resolves "has a role row" + the app_role KEY (not the
  // legacy enum — matters for custom roles like 'logistics') in ONE
  // cached round trip, AND warms the permission cache that Sidebar's
  // synchronous hasPermission() reads. Without this warm-up the nav
  // renders empty on a cold process (e.g. right after a deploy).
  const { exists, role } = await getRoleInfo(session.user.id);

  if (!exists) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold mb-2">No role assigned</h1>
          <p className="text-sm text-[var(--color-muted)]">Your account has no role yet. Contact an administrator.</p>
        </div>
      </div>
    );
  }

  return (
    <AppShell
      email={session.user.email}
      name={session.user.name ?? null}
      role={role}
    >
      {children}
    </AppShell>
  );
}
