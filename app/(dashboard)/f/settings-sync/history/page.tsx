import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ChevronLeft, History as HistoryIcon, ArrowRight, CheckCircle2, AlertCircle, AlertTriangle, Undo2 } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { db, schema } from '@/db/client';
import { hasPermission, type Role } from '@/lib/auth/rbac';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

type RunStatus = 'success' | 'failed' | 'partial' | 'rolled_back' | string;

export default async function HistoryPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const [roleRow] = await db.select().from(schema.roles).where(eq(schema.roles.userId, session.user.id)).limit(1);
  const role = roleRow?.role as Role | undefined;
  if (!role || !hasPermission(role, 'view_settings_history')) return <p>Forbidden.</p>;

  const runs = await db.select().from(schema.applyRuns)
    .orderBy(desc(schema.applyRuns.startedAt)).limit(50);

  const success = runs.filter((r) => r.status === 'success').length;
  const partial = runs.filter((r) => r.status === 'partial').length;
  const failed = runs.filter((r) => r.status === 'failed').length;
  const rolled = runs.filter((r) => r.status === 'rolled_back').length;

  return (
    <div className="max-w-6xl mx-auto px-6 md:px-10 py-8 md:py-12 space-y-10">
      <Link
        href="/f/settings-sync"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="size-4" />
        Settings Sync
      </Link>

      <header className="space-y-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <HistoryIcon className="size-3.5" />
          Settings Sync history
        </div>
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">Apply history</h1>
        <p className="text-sm text-muted-foreground max-w-xl">
          Each row is one apply run across one or more stores. Click into a row to inspect per-store results and roll back.
        </p>
      </header>

      {runs.length > 0 && (
        <div className="grid grid-cols-4 gap-px bg-border rounded-2xl overflow-hidden border border-border">
          <Stat label="Success" value={String(success)} tone="success" />
          <Stat label="Partial" value={String(partial)} tone={partial > 0 ? 'warning' : 'default'} />
          <Stat label="Failed" value={String(failed)} tone={failed > 0 ? 'error' : 'default'} />
          <Stat label="Rolled back" value={String(rolled)} />
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {runs.length === 0 ? (
            <div className="text-center py-16">
              <HistoryIcon className="size-8 mx-auto text-muted-foreground mb-3" />
              <div className="text-sm font-medium">No apply runs yet</div>
              <div className="text-xs text-muted-foreground mt-1">
                Runs from <Link href="/f/settings-sync/apply" className="underline hover:text-foreground">Apply</Link> will land here.
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {runs.map((r) => {
                const when = new Date(r.startedAt);
                return (
                  <li key={r.id}>
                    <Link
                      href={`/f/settings-sync/history/${r.id}`}
                      className="px-5 py-4 flex items-center justify-between gap-4 hover:bg-muted/40 transition-colors group"
                    >
                      <div className="flex items-center gap-4 min-w-0">
                        <StatusGlyph status={r.status as RunStatus} />
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">
                            <span className="uppercase tracking-wider text-xs text-muted-foreground mr-2">{r.domain}</span>
                            {r.targetStoreIds.length} {r.targetStoreIds.length === 1 ? 'store' : 'stores'}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            {when.toLocaleString()}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <StatusBadge status={r.status as RunStatus} />
                        <ArrowRight className="size-3.5 text-muted-foreground/50 group-hover:text-muted-foreground group-hover:translate-x-0.5 transition-all" />
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'success' | 'warning' | 'error' | 'default' }) {
  const c = {
    success: 'text-emerald-600 dark:text-emerald-500',
    warning: 'text-amber-600 dark:text-amber-500',
    error: 'text-destructive',
    default: '',
  }[tone];
  return (
    <div className="bg-card p-5 space-y-1.5">
      <div className="text-muted-foreground text-xs uppercase tracking-wider">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums ${c}`}>{value}</div>
    </div>
  );
}

function StatusGlyph({ status }: { status: RunStatus }) {
  if (status === 'success') return <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />;
  if (status === 'partial') return <AlertTriangle className="size-4 text-amber-500 shrink-0" />;
  if (status === 'rolled_back') return <Undo2 className="size-4 text-muted-foreground shrink-0" />;
  return <AlertCircle className="size-4 text-destructive shrink-0" />;
}

function StatusBadge({ status }: { status: RunStatus }) {
  if (status === 'success') return <Badge variant="default" className="h-5 text-[10px] uppercase tracking-wider">Success</Badge>;
  if (status === 'partial') {
    return (
      <Badge variant="outline" className="h-5 text-[10px] uppercase tracking-wider text-amber-600 dark:text-amber-500 border-amber-200 dark:border-amber-900">
        Partial
      </Badge>
    );
  }
  if (status === 'rolled_back') return <Badge variant="outline" className="h-5 text-[10px] uppercase tracking-wider">Rolled back</Badge>;
  return <Badge variant="destructive" className="h-5 text-[10px] uppercase tracking-wider">Failed</Badge>;
}
