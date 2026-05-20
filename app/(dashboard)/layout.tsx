import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth/auth';
import { db, schema } from '@/db/client';
import type { Role } from '@/lib/auth/rbac';
import { AppShell } from '@/components/shell/AppShell';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');

  const [roleRow] = await db.select().from(schema.roles).where(eq(schema.roles.userId, session.user.id)).limit(1);
  const role = (roleRow?.role as Role | undefined) ?? null;

  if (!role) {
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
