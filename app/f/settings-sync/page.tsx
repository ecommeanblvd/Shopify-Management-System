import Link from 'next/link';
import { headers } from 'next/headers';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth/auth';
import { db, schema } from '@/db/client';
import type { Role } from '@/lib/auth/rbac';

export const dynamic = 'force-dynamic';

export default async function SettingsSyncHome() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return <p>Please sign in.</p>;
  const [roleRow] = await db.select().from(schema.roles).where(eq(schema.roles.userId, session.user.id)).limit(1);
  if (!roleRow) return <p>Your account has no assigned role. Contact an administrator.</p>;
  const role = roleRow.role as Role;

  const pending = await db.select().from(schema.reconciliationStatus)
    .where(eq(schema.reconciliationStatus.status, 'pending'));

  return (
    <main style={{ padding: 24 }}>
      <h1>Settings Sync</h1>
      {pending.length > 0 && (
        <p style={{ background: '#fff3cd', padding: 12, border: '1px solid #ffeeba' }}>
          {pending.length} store/domain pairs need reconciliation before they can receive applies.
        </p>
      )}
      <nav style={{ display: 'flex', gap: 16, marginTop: 24 }}>
        <Link href="/f/settings-sync/templates">Templates</Link>
        <Link href="/f/settings-sync/apply">Apply</Link>
        <Link href="/f/settings-sync/history">History</Link>
      </nav>
      <p style={{ marginTop: 24, color: '#666' }}>Signed in as {role}.</p>
    </main>
  );
}
