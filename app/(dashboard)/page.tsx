import Link from 'next/link';
import { eq, desc } from 'drizzle-orm';
import { headers } from 'next/headers';
import { Plus, Store as StoreIcon, CheckCircle2, AlertTriangle, Activity, ArrowRight, ChevronRight, Globe, Settings, Eye } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { db, schema } from '@/db/client';
import { hasPermission, type Role } from '@/lib/auth/rbac';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

function statusVariant(status: string): 'default' | 'destructive' | 'outline' {
  if (status === 'active') return 'default';
  if (status === 'error') return 'destructive';
  return 'outline';
}

export default async function HomePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  const callerRole = session
    ? (await db.select().from(schema.roles).where(eq(schema.roles.userId, session.user.id)).limit(1))[0]?.role as Role | undefined
    : undefined;
  const canManageStores = !!callerRole && hasPermission(callerRole, 'manage_stores');
  const canViewMarkets = !!callerRole && hasPermission(callerRole, 'view_markets_history');
  const canRunFeature = !!callerRole && hasPermission(callerRole, 'run_feature');

  const stores = await db.select().from(schema.stores);
  const pendingReconciliation = await db.select().from(schema.reconciliationStatus)
    .where(eq(schema.reconciliationStatus.status, 'pending'));
  const recentRuns = await db.select().from(schema.applyRuns)
    .orderBy(desc(schema.applyRuns.startedAt)).limit(5);
  const recentMarketRuns = await db.select().from(schema.marketApplyHistory)
    .orderBy(desc(schema.marketApplyHistory.createdAt)).limit(5);

  const active = stores.filter((s) => s.status === 'active').length;
  const errored = stores.filter((s) => s.status === 'error').length;
  const userName = session?.user?.name ?? session?.user?.email ?? 'there';

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-10">
      {/* Hero */}
      <header className="flex items-start justify-between gap-6 flex-wrap">
        <div className="space-y-2 min-w-0">
          <p className="text-sm text-muted-foreground">Welcome back, {userName}</p>
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">Dashboard</h1>
        </div>
        {canManageStores && (
          <Link href="/stores/connect" className={buttonVariants() + ' gap-1.5 px-4 h-9'}>
            <Plus className="size-4" />
            Connect a store
          </Link>
        )}
      </header>

      {/* Stat strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border rounded-2xl overflow-hidden border border-border">
        <StatTile
          icon={<StoreIcon className="size-4" />}
          label="Stores"
          value={String(stores.length)}
          sub={stores.length === 0 ? 'Connect your first' : `${active} active`}
        />
        <StatTile
          icon={<CheckCircle2 className="size-4" />}
          label="Active"
          value={String(active)}
          sub={errored > 0 ? `${errored} errored` : 'All healthy'}
          tone={errored > 0 ? 'warning' : 'default'}
        />
        <StatTile
          icon={<AlertTriangle className="size-4" />}
          label="Needs reconcile"
          value={String(pendingReconciliation.length)}
          sub={pendingReconciliation.length === 0 ? 'In sync' : 'Action required'}
          tone={pendingReconciliation.length > 0 ? 'warning' : 'default'}
        />
        <StatTile
          icon={<Activity className="size-4" />}
          label="Apply runs (7d)"
          value={String(recentRuns.length + recentMarketRuns.length)}
          sub="Settings + Markets"
        />
      </div>

      {/* Two-column: Stores list + Recent activity */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-6">
        {/* Stores */}
        <Card>
          <CardContent className="p-6 md:p-7 space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">Connected stores</h2>
                <p className="text-xs text-muted-foreground">Shopify accounts wired into this workspace.</p>
              </div>
              {canManageStores && stores.length > 0 && (
                <Link href="/stores/connect" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                  Add another
                  <ChevronRight className="size-3" />
                </Link>
              )}
            </div>

            {stores.length === 0 ? (
              <div className="text-center py-12 border border-dashed border-border rounded-xl">
                <StoreIcon className="size-8 mx-auto text-muted-foreground mb-3" />
                <div className="text-sm font-medium">No stores connected yet</div>
                <div className="text-xs text-muted-foreground mt-1 mb-4">
                  Connect a Shopify store to enable Settings Sync and Markets.
                </div>
                {canManageStores && (
                  <Link href="/stores/connect" className={buttonVariants({ variant: 'outline', size: 'sm' }) + ' gap-1.5 px-3'}>
                    <Plus className="size-3.5" />
                    Connect a store
                  </Link>
                )}
              </div>
            ) : (
              <ul className="space-y-2">
                {stores.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-4 rounded-xl border border-border px-4 py-3 hover:border-foreground/20 hover:bg-muted/40 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      <StatusDot status={s.status} />
                      <div className="min-w-0">
                        <div className="font-medium truncate">{s.name}</div>
                        <div className="text-xs text-muted-foreground font-mono truncate">{s.shopDomain}</div>
                      </div>
                    </div>
                    <Badge variant={statusVariant(s.status)} className="h-5 text-[10px] uppercase tracking-wider shrink-0">
                      {s.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Quick access + Recent runs */}
        <div className="space-y-6">
          {/* Quick access */}
          <Card>
            <CardContent className="p-6 md:p-7 space-y-3">
              <h2 className="text-lg font-semibold tracking-tight">Quick access</h2>
              <div className="space-y-1.5">
                {canRunFeature && <QuickLink href="/f/settings-viewer" icon={<Eye className="size-4" />} label="Settings Viewer" desc="Inspect shipping + checkout" />}
                {canRunFeature && <QuickLink href="/f/settings-sync" icon={<Settings className="size-4" />} label="Settings Sync" desc="Push templates to stores" />}
                {canViewMarkets && <QuickLink href="/f/markets" icon={<Globe className="size-4" />} label="Markets" desc="Region templates + apply" />}
              </div>
            </CardContent>
          </Card>

          {/* Recent activity */}
          <Card>
            <CardContent className="p-6 md:p-7 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold tracking-tight">Recent activity</h2>
                {(recentRuns.length > 0 || recentMarketRuns.length > 0) && (
                  <Link href="/f/settings-sync/history" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                    All
                    <ChevronRight className="size-3" />
                  </Link>
                )}
              </div>
              <ActivityFeed
                settingsRuns={recentRuns.slice(0, 3).map((r) => ({
                  id: r.id, kind: 'settings' as const, domain: r.domain, status: r.status, when: r.startedAt,
                }))}
                marketRuns={recentMarketRuns.slice(0, 3).map((r) => ({
                  id: r.id, kind: 'markets' as const, action: r.action, status: r.status, when: r.createdAt,
                }))}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function StatTile({
  icon, label, value, sub, tone = 'default',
}: { icon: React.ReactNode; label: string; value: string; sub: string; tone?: 'default' | 'warning' }) {
  const valueClass = tone === 'warning' ? 'text-amber-600 dark:text-amber-500' : '';
  return (
    <div className="bg-card p-5 space-y-2">
      <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wider">
        {icon}
        {label}
      </div>
      <div className={`text-2xl font-semibold tracking-tight tabular-nums ${valueClass}`}>{value}</div>
      <div className="text-xs text-muted-foreground truncate">{sub}</div>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const color = status === 'active'
    ? 'bg-emerald-500'
    : status === 'error'
      ? 'bg-destructive'
      : 'bg-muted-foreground/40';
  return <span className={'size-2 rounded-full shrink-0 ' + color} aria-hidden />;
}

function QuickLink({ href, icon, label, desc }: { href: string; icon: React.ReactNode; label: string; desc: string }) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-muted/60 transition-colors"
    >
      <div className="size-8 rounded-lg bg-muted/60 text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary flex items-center justify-center transition-colors">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium leading-tight">{label}</div>
        <div className="text-xs text-muted-foreground leading-tight mt-0.5">{desc}</div>
      </div>
      <ArrowRight className="size-3.5 text-muted-foreground/50 group-hover:text-muted-foreground group-hover:translate-x-0.5 transition-all" />
    </Link>
  );
}

interface SettingsRun { id: string; kind: 'settings'; domain: string; status: string; when: Date | string }
interface MarketRun { id: string; kind: 'markets'; action: string; status: string; when: Date | string }
type ActivityItem = SettingsRun | MarketRun;

function ActivityFeed({ settingsRuns, marketRuns }: { settingsRuns: SettingsRun[]; marketRuns: MarketRun[] }) {
  const all: ActivityItem[] = [...settingsRuns, ...marketRuns]
    .sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime())
    .slice(0, 5);
  if (all.length === 0) {
    return <div className="text-xs text-muted-foreground italic py-2">No runs yet.</div>;
  }
  return (
    <ul className="space-y-1.5">
      {all.map((r) => <ActivityRow key={`${r.kind}-${r.id}`} item={r} />)}
    </ul>
  );
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const ok = item.status === 'success' || item.status === 'applied';
  const partial = item.status === 'partial' || item.status === 'partial_error';
  const dotClass = ok ? 'bg-emerald-500' : partial ? 'bg-amber-500' : 'bg-destructive';
  const label = item.kind === 'settings' ? `Settings · ${item.domain}` : `Markets · ${item.action}`;
  const when = new Date(item.when);
  return (
    <li className="flex items-center gap-3 text-xs py-1.5">
      <span className={'size-1.5 rounded-full shrink-0 ' + dotClass} aria-hidden />
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{label}</div>
        <div className="text-muted-foreground">{when.toLocaleString()}</div>
      </div>
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{item.status}</span>
    </li>
  );
}
