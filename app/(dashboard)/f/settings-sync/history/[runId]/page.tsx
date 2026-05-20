import { eq, and, desc } from 'drizzle-orm';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { db, schema } from '@/db/client';
import { hasPermission, type Role } from '@/lib/auth/rbac';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';

export const dynamic = 'force-dynamic';

async function rollbackAction(runId: string, userId: string) {
  'use server';
  const [roleRow] = await db.select().from(schema.roles).where(eq(schema.roles.userId, userId)).limit(1);
  const role = roleRow?.role as Role | undefined;
  if (!role || !hasPermission(role, 'apply_settings')) return;
  // Spec #2 MVP: this only marks the run as rolled_back. A follow-up PR
  // implements the inverse-apply flow that re-runs apply with the snapshot
  // payload as the effective tree (see spec #2 section 5).
  await db.update(schema.applyRuns).set({ status: 'rolled_back', finishedAt: new Date() }).where(eq(schema.applyRuns.id, runId));
}

export default async function RunDetail({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const [roleRow] = await db.select().from(schema.roles).where(eq(schema.roles.userId, session.user.id)).limit(1);
  const role = roleRow?.role as Role | undefined;

  const [run] = await db.select().from(schema.applyRuns).where(eq(schema.applyRuns.id, runId)).limit(1);
  if (!run) return <p>Run not found.</p>;
  const snapshots = await db.select().from(schema.settingsSnapshots).where(and(eq(schema.settingsSnapshots.applyRunId, runId))).orderBy(desc(schema.settingsSnapshots.capturedAt));

  const canRollback = role && hasPermission(role, 'apply_settings') && run.status !== 'rolled_back';
  const bound = rollbackAction.bind(null, runId, session.user.id);

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Run <span className="font-mono text-sm">{runId.slice(0, 8)}</span></h1>
        <Badge>{run.status}</Badge>
      </div>

      <Card>
        <CardHeader><CardTitle>Summary</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div>Domain: <span className="font-mono">{run.domain}</span></div>
          <div>Targets: {run.targetStoreIds.length} stores</div>
          <pre className="text-xs font-mono p-3 rounded-md bg-[var(--color-muted-surface)] overflow-auto max-h-64">{JSON.stringify(run.summary, null, 2)}</pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Snapshots ({snapshots.length})</CardTitle></CardHeader>
        <CardContent>
          {snapshots.length === 0 ? <p className="text-sm text-[var(--color-muted)]">No snapshots captured.</p> : (
            <ul className="text-sm space-y-1">
              {snapshots.map((s) => <li key={s.id} className="font-mono text-xs">{s.storeId} / {s.domain} — {new Date(s.capturedAt).toLocaleString()}</li>)}
            </ul>
          )}
        </CardContent>
      </Card>

      {canRollback && (
        <Card>
          <CardHeader><CardTitle>Rollback</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Alert>
              <AlertDescription>This only marks the run as rolled back. Restoring store settings from the snapshot is not yet implemented and must be done manually.</AlertDescription>
            </Alert>
            <form action={bound}><Button type="submit" variant="outline">Mark as rolled back (manual restore required)</Button></form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
