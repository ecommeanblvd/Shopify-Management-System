import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth/auth';
import { db, schema } from '@/db/client';
import { getRole } from '@/lib/auth/role';
import { AppShell } from '@/components/shell/AppShell';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');

  // Existence check gates the "no role" state. Then getRole() resolves the
  // app_role KEY (not the legacy enum — matters for custom roles like
  // 'logistics') AND warms the permission cache that Sidebar's synchronous
  // hasPermission() reads. Without this warm-up the nav renders empty on a
  // cold process (e.g. right after a deploy).
  const [roleRow] = await db
    .select({ userId: schema.roles.userId })
    .from(schema.roles)
    .where(eq(schema.roles.userId, session.user.id))
    .limit(1);

  if (!roleRow) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold mb-2">No role assigned</h1>
          <p className="text-sm text-[var(--color-muted)]">Your account has no role yet. Contact an administrator.</p>
        </div>
      </div>
    );
  }

  const role = await getRole(session.user.id);

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
