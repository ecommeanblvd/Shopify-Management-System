import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { FileText, Play, History, AlertTriangle, ArrowRight, Settings as SettingsIcon } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { db, schema } from '@/db/client';
import { hasPermission, type Role } from '@/lib/auth/rbac';
import { Card, CardContent } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

export default async function SettingsSyncHome() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const [roleRow] = await db.select().from(schema.roles).where(eq(schema.roles.userId, session.user.id)).limit(1);
  const role = roleRow?.role as Role | undefined;
  if (!role || !hasPermission(role, 'run_feature')) return <p>Forbidden.</p>;

  const pending = await db.select().from(schema.reconciliationStatus)
    .where(eq(schema.reconciliationStatus.status, 'pending'));
  const templates = await db.select().from(schema.settingTemplates);
  const lastRun = await db.select().from(schema.applyRuns)
    .orderBy(desc(schema.applyRuns.startedAt)).limit(1);

  return (
    <div className="max-w-6xl mx-auto px-6 md:px-10 py-8 md:py-12 space-y-10">
      <header className="space-y-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <SettingsIcon className="size-3.5" />
          Feature
        </div>
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">Settings Sync</h1>
        <p className="text-sm text-muted-foreground max-w-xl">
          Author shipping and checkout-branding templates once, then push them to any subset of stores with diff-preview and one-click rollback.
        </p>
      </header>

      {pending.length > 0 && (
        <ReconcileBanner count={pending.length} />
      )}

      {/* Stat strip */}
      <div className="grid grid-cols-3 gap-px bg-border rounded-2xl overflow-hidden border border-border">
        <StatTile label="Templates" value={String(templates.length)} sub={templates.length === 0 ? 'None yet' : 'Authored'} />
        <StatTile label="Pending reconcile" value={String(pending.length)} sub={pending.length === 0 ? 'In sync' : 'Action required'} tone={pending.length > 0 ? 'warning' : 'default'} />
        <StatTile label="Last apply" value={lastRun[0] ? relativeTime(lastRun[0].startedAt) : '—'} sub={lastRun[0]?.status ?? 'No runs yet'} />
      </div>

      {/* Sub-features */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <FeatureCard
          href="/f/settings-sync/templates"
          icon={<FileText className="size-5" />}
          title="Templates"
          desc="Define the canonical shape of shipping and checkout settings."
          count={templates.length}
          countLabel={templates.length === 1 ? 'template' : 'templates'}
        />
        <FeatureCard
          href="/f/settings-sync/apply"
          icon={<Play className="size-5" />}
          title="Apply"
          desc="Diff a template against each store, then push the chosen changes."
          accent
        />
        <FeatureCard
          href="/f/settings-sync/history"
          icon={<History className="size-5" />}
          title="History"
          desc="Past runs with rollback. Every apply is auditable."
        />
      </div>
    </div>
  );
}

function ReconcileBanner({ count }: { count: number }) {
  return (
    <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-100 px-5 py-4 flex items-start gap-3">
      <AlertTriangle className="size-5 shrink-0 mt-0.5" />
      <div className="flex-1">
        <div className="font-medium text-sm">
          {count} store/domain pair{count === 1 ? '' : 's'} need reconciliation
        </div>
        <p className="text-sm opacity-80 mt-1">
          Out-of-band edits in Shopify admin were detected. Reconcile each pair before the next apply so nothing is overwritten silently.
        </p>
      </div>
      <Link href="/f/settings-sync/history" className="text-sm font-medium inline-flex items-center gap-1 hover:underline">
        Review
        <ArrowRight className="size-3.5" />
      </Link>
    </div>
  );
}

function StatTile({
  label, value, sub, tone = 'default',
}: { label: string; value: string; sub: string; tone?: 'default' | 'warning' }) {
  const valueClass = tone === 'warning' ? 'text-amber-600 dark:text-amber-500' : '';
  return (
    <div className="bg-card p-5 space-y-2">
      <div className="text-muted-foreground text-xs uppercase tracking-wider">{label}</div>
      <div className={`text-2xl font-semibold tracking-tight tabular-nums ${valueClass}`}>{value}</div>
      <div className="text-xs text-muted-foreground truncate">{sub}</div>
    </div>
  );
}

function FeatureCard({
  href, icon, title, desc, count, countLabel, accent = false,
}: {
  href: string; icon: React.ReactNode; title: string; desc: string;
  count?: number; countLabel?: string; accent?: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        'group relative rounded-2xl border bg-card p-5 transition-all overflow-hidden flex flex-col h-full ' +
        (accent
          ? 'border-primary/40 hover:border-primary bg-primary/[0.03]'
          : 'border-border hover:border-foreground/30 hover:bg-card/80')
      }
    >
      {accent && (
        <div className="absolute -top-12 -right-12 size-32 rounded-full bg-primary/10 pointer-events-none" aria-hidden />
      )}
      <div className="space-y-3 flex-1">
        <div className={'size-10 rounded-xl flex items-center justify-center ' + (accent ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
          {icon}
        </div>
        <div>
          <h3 className="font-semibold tracking-tight">{title}</h3>
          <p className="text-sm text-muted-foreground mt-1">{desc}</p>
        </div>
      </div>
      <div className="mt-4 pt-4 border-t border-border flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          {count !== undefined ? `${count} ${countLabel}` : accent ? 'Start a new apply' : 'View past runs'}
        </span>
        <ArrowRight className="size-3.5 text-muted-foreground group-hover:translate-x-0.5 group-hover:text-foreground transition-all" />
      </div>
    </Link>
  );
}

function relativeTime(date: Date | string): string {
  const d = new Date(date);
  const diffMs = Date.now() - d.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const dys = Math.floor(h / 24);
  return `${dys}d ago`;
}
