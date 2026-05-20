import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { db, schema } from '@/db/client';
import { hasPermission, type Role } from '@/lib/auth/rbac';

export const dynamic = 'force-dynamic';

export default async function HistoryPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const [roleRow] = await db.select().from(schema.roles).where(eq(schema.roles.userId, session.user.id)).limit(1);
  const role = roleRow?.role as Role | undefined;
  if (!role || !hasPermission(role, 'view_settings_history')) return <p>Forbidden.</p>;

  const runs = await db.select().from(schema.applyRuns).orderBy(desc(schema.applyRuns.startedAt)).limit(50);
  return (
    <main style={{ padding: 24 }}>
      <h1>Apply history</h1>
      <table>
        <thead><tr><th>When</th><th>Domain</th><th>Stores</th><th>Status</th><th /></tr></thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id}>
              <td>{r.startedAt.toString()}</td>
              <td>{r.domain}</td>
              <td>{r.targetStoreIds.length}</td>
              <td>{r.status}</td>
              <td><Link href={`/f/settings-sync/history/${r.id}`}>Detail</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
