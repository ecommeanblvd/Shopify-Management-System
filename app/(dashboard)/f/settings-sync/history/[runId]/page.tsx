import Link from 'next/link';
import { eq, and, desc } from 'drizzle-orm';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ChevronLeft, History as HistoryIcon, Undo2, CheckCircle2, AlertCircle, AlertTriangle, Camera, Code } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { db, schema } from '@/db/client';
import { hasPermission, type Role } from '@/lib/auth/rbac';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

type RunStatus = 'success' | 'failed' | 'partial' | 'rolled_back' | string;

async function rollbackAction(runId: string, userId: string) {
  'use server';
  const [roleRow] = await db.select().from(schema.roles).where(eq(schema.roles.userId, userId)).limit(1);
  const role = roleRow?.role as Role | undefined;
  if (!role || !hasPermission(role, 'apply_settings')) return;
  // Spec #2 MVP: marks the run as rolled_back. Restore-from-snapshot lands later.
  await db.update(schema.applyRuns).set({ status: 'rolled_back', finishedAt: new Date() }).where(eq(schema.applyRuns.id, runId));
}

export default async function RunDetail({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const [roleRow] = await db.select().from(schema.roles).where(eq(schema.roles.userId, session.user.id)).limit(1);
  const role = roleRow?.role as Role | undefined;

  const [run] = await db.select().from(schema.applyRuns).where(eq(schema.applyRuns.id, runId)).limit(1);
  if (!run) {
    return (
      <div className="max-w-3xl mx-auto px-6 md:px-10 py-16 text-center space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Run not found</h1>
        <p className="text-sm text-muted-foreground">Check the run ID and try again.</p>
        <Link href="/f/settings-sync/history" className="text-sm underline">Back to history</Link>
      </div>
    );
  }

  const snapshots = await db.select().from(schema.settingsSnapshots)
    .where(and(eq(schema.settingsSnapshots.applyRunId, runId)))
    .orderBy(desc(schema.settingsSnapshots.capturedAt));

  const canRollback = !!role && hasPermission(role, 'apply_settings') && run.status !== 'rolled_back';
  const bound = rollbackAction.bind(null, runId, session.user.id);
  const duration = run.finishedAt
    ? Math.max(0, new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime())
    : null;

  return (
    <div className="max-w-5xl mx-auto px-6 md:px-10 py-8 md:py-12 space-y-10">
      <Link
        href="/f/settings-sync/history"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="size-4" />
        History
      </Link>

      <header className="space-y-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <HistoryIcon className="size-3.5" />
          Apply run
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight font-mono">
            {runId.slice(0, 8)}
          </h1>
          <StatusBadge status={run.status as RunStatus} />
        </div>
        <p className="text-sm text-muted-foreground font-mono">{runId}</p>
      </header>

      {/* Stat strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border rounded-2xl overflow-hidden border border-border">
        <StatTile label="Domain" value={run.domain} />
        <StatTile label="Targets" value={String(run.targetStoreIds.length)} sub={run.targetStoreIds.length === 1 ? 'store' : 'stores'} />
        <StatTile label="Started" value={new Date(run.startedAt).toLocaleTimeString()} sub={new Date(run.startedAt).toLocaleDateString()} />
        <StatTile label="Duration" value={duration != null ? `${(duration / 1000).toFixed(1)}s` : '—'} sub={duration != null ? 'finished' : 'still running'} />
      </div>

      {/* Summary JSON */}
      <Card>
        <CardContent className="p-6 md:p-8 space-y-4">
          <div className="flex items-center gap-2">
            <Code className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold uppercase tracking-wider">Summary</h2>
          </div>
          <pre className="text-xs font-mono p-4 rounded-xl bg-muted/40 border border-border overflow-auto max-h-64">
            {JSON.stringify(run.summary, null, 2)}
          </pre>
        </CardContent>
      </Card>

      {/* Snapshots */}
      <Card>
        <CardContent className="p-6 md:p-8 space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Camera className="size-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold uppercase tracking-wider">Pre-apply snapshots</h2>
            </div>
            <Badge variant="outline" className="h-5 text-[10px] uppercase tracking-wider">
              {snapshots.length} captured
            </Badge>
          </div>
          {snapshots.length === 0 ? (
            <div className="text-sm text-muted-foreground italic py-2">No snapshots captured for this run.</div>
          ) : (
            <ul className="space-y-1.5">
              {snapshots.map((s) => (
                <li key={s.id} className="px-4 py-2.5 rounded-lg border border-border hover:bg-muted/30 transition-colors">
                  <div className="text-xs font-mono truncate">
                    <span className="text-muted-foreground">{s.domain}</span>
                    <span className="mx-2 text-muted-foreground/40">·</span>
                    <span>{s.storeId}</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    Captured {new Date(s.capturedAt).toLocaleString()}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Rollback */}
      {canRollback && (
        <Card>
          <CardContent className="p-6 md:p-8 space-y-4">
            <div className="flex items-center gap-2">
              <Undo2 className="size-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold uppercase tracking-wider">Rollback</h2>
            </div>
            <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-100 px-5 py-3.5 flex items-start gap-3 text-sm">
              <AlertTriangle className="size-4 shrink-0 mt-0.5" />
              <div>
                Marks this run as <span className="font-mono">rolled_back</span> in the history log. Restoring the snapshot payload to the store still needs to be done manually until the auto-restore flow lands.
              </div>
            </div>
            <form action={bound}>
              <Button type="submit" variant="outline" className="gap-2">
                <Undo2 className="size-4" />
                Mark as rolled back
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-card p-5 space-y-1.5">
      <div className="text-muted-foreground text-xs uppercase tracking-wider">{label}</div>
      <div className="text-base font-semibold tabular-nums truncate">{value}</div>
      {sub && <div className="text-xs text-muted-foreground truncate">{sub}</div>}
    </div>
  );
}

function StatusBadge({ status }: { status: RunStatus }) {
  if (status === 'success') return <Badge variant="default" className="h-7 px-3 gap-1.5"><CheckCircle2 className="size-3.5" /> Success</Badge>;
  if (status === 'partial') {
    return (
      <Badge variant="outline" className="h-7 px-3 gap-1.5 text-amber-600 dark:text-amber-500 border-amber-200 dark:border-amber-900">
        <AlertTriangle className="size-3.5" /> Partial
      </Badge>
    );
  }
  if (status === 'rolled_back') return <Badge variant="outline" className="h-7 px-3 gap-1.5"><Undo2 className="size-3.5" /> Rolled back</Badge>;
  return <Badge variant="destructive" className="h-7 px-3 gap-1.5"><AlertCircle className="size-3.5" /> Failed</Badge>;
}
