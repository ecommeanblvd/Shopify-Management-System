import { eq, and, desc } from 'drizzle-orm';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { db, schema } from '@/db/client';
import { hasPermission, type Role } from '@/lib/auth/rbac';

export const dynamic = 'force-dynamic';

async function rollbackAction(runId: string, userId: string) {
  'use server';
  const [roleRow] = await db.select().from(schema.roles).where(eq(schema.roles.userId, userId)).limit(1);
  const role = roleRow?.role as Role | undefined;
  if (!role || !hasPermission(role, 'apply_settings')) return;
  // Spec #2 MVP: mark the run as rolled_back. A follow-up PR implements the
  // inverse-apply flow that re-runs apply with the snapshot payload as the
  // effective tree (see spec section 5).
  await db.update(schema.applyRuns).set({ status: 'rolled_back', finishedAt: new Date() })
    .where(eq(schema.applyRuns.id, runId));
}

export default async function RunDetail({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const [roleRow] = await db.select().from(schema.roles).where(eq(schema.roles.userId, session.user.id)).limit(1);
  const role = roleRow?.role as Role | undefined;

  const [run] = await db.select().from(schema.applyRuns).where(eq(schema.applyRuns.id, runId)).limit(1);
  if (!run) return <p>Run not found.</p>;
  const snapshots = await db.select().from(schema.settingsSnapshots)
    .where(and(eq(schema.settingsSnapshots.applyRunId, runId)))
    .orderBy(desc(schema.settingsSnapshots.capturedAt));

  const rollbackBound = rollbackAction.bind(null, runId, session.user.id);
  const canRollback = role && hasPermission(role, 'apply_settings') && run.status !== 'rolled_back';

  return (
    <main style={{ padding: 24 }}>
      <h1>Apply run {runId}</h1>
      <p>Status: <strong>{run.status}</strong></p>
      <p>Domain: {run.domain}</p>
      <p>Targets: {run.targetStoreIds.length} stores</p>
      <h2>Summary</h2>
      <pre>{JSON.stringify(run.summary, null, 2)}</pre>
      <h2>Snapshots ({snapshots.length})</h2>
      <ul>{snapshots.map((s) => <li key={s.id}>{s.storeId} / {s.domain} — {s.capturedAt.toString()}</li>)}</ul>
      {canRollback && (
        <form action={rollbackBound}><button type="submit" style={{ background: '#e57', color: '#fff', padding: 8 }}>Rollback</button></form>
      )}
    </main>
  );
}
