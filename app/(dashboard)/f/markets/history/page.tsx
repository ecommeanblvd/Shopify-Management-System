import Link from 'next/link';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { desc } from 'drizzle-orm';
import { ChevronLeft, History as HistoryIcon, CheckCircle2, AlertCircle, AlertTriangle } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { db, schema } from '@/db/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

type RunStatus = 'success' | 'partial_error' | 'failed' | string;

export default async function HistoryPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/auth/sign-in');
  const role = await getRole(session.user.id);
  if (!hasPermission(role, 'view_markets_history')) {
    return <div className="p-8">Forbidden</div>;
  }

  const rows = await db.select().from(schema.marketApplyHistory)
    .orderBy(desc(schema.marketApplyHistory.createdAt))
    .limit(100);

  const stores = new Map(
    (await db.select().from(schema.stores)).map((s) => [s.id, { name: s.name, domain: s.shopDomain }] as const),
  );

  const success = rows.filter((r) => r.status === 'success').length;
  const partial = rows.filter((r) => r.status === 'partial_error').length;
  const failed = rows.filter((r) => r.status === 'failed').length;

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-10">
      <Link
        href="/f/markets"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="size-4" />
        Markets
      </Link>

      <header className="space-y-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <HistoryIcon className="size-3.5" />
          Markets apply history
        </div>
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">Apply history</h1>
        <p className="text-sm text-muted-foreground max-w-xl">
          Every markets apply run, oldest at the bottom. Showing the most recent 100.
        </p>
      </header>

      {rows.length > 0 && (
        <div className="grid grid-cols-3 gap-px bg-border rounded-2xl overflow-hidden border border-border">
          <Stat label="Success" value={String(success)} tone="success" />
          <Stat label="Partial" value={String(partial)} tone={partial > 0 ? 'warning' : 'default'} />
          <Stat label="Failed" value={String(failed)} tone={failed > 0 ? 'error' : 'default'} />
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="text-center py-16">
              <HistoryIcon className="size-8 mx-auto text-muted-foreground mb-3" />
              <div className="text-sm font-medium">No apply history yet</div>
              <div className="text-xs text-muted-foreground mt-1">
                Runs from <Link href="/f/markets/apply" className="underline hover:text-foreground">/f/markets/apply</Link> will land here.
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((r) => {
                const store = stores.get(r.storeId);
                const when = new Date(r.createdAt);
                return (
                  <li key={r.id} className="px-5 py-4 flex items-center justify-between gap-4 hover:bg-muted/40 transition-colors">
                    <div className="flex items-center gap-4 min-w-0">
                      <StatusGlyph status={r.status as RunStatus} />
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">
                          {store?.name ?? r.storeId}
                          <span className="text-muted-foreground ml-2 font-normal text-xs uppercase tracking-wider">{r.action}</span>
                        </div>
                        <div className="text-xs text-muted-foreground font-mono truncate">
                          {store?.domain ?? '—'} · {when.toLocaleString()}
                        </div>
                      </div>
                    </div>
                    <StatusBadge status={r.status as RunStatus} />
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

function Stat({ label, value, tone }: { label: string; value: string; tone: 'success' | 'warning' | 'error' | 'default' }) {
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
  if (status === 'partial_error') return <AlertTriangle className="size-4 text-amber-500 shrink-0" />;
  return <AlertCircle className="size-4 text-destructive shrink-0" />;
}

function StatusBadge({ status }: { status: RunStatus }) {
  if (status === 'success') return <Badge variant="default" className="h-5 text-[10px] uppercase tracking-wider shrink-0">Success</Badge>;
  if (status === 'partial_error') {
    return (
      <Badge variant="outline" className="h-5 text-[10px] uppercase tracking-wider text-amber-600 dark:text-amber-500 border-amber-200 dark:border-amber-900 shrink-0">
        Partial
      </Badge>
    );
  }
  return <Badge variant="destructive" className="h-5 text-[10px] uppercase tracking-wider shrink-0">Failed</Badge>;
}
