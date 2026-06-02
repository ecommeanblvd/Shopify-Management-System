import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  ChevronLeft, Activity, CircleCheck, CircleAlert, CircleX,
  CircleHelp, ExternalLink, Heart, Eye, Gift, Bookmark,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { FUNCTIONS } from '@/lib/registry/functions';
import {
  getFunctionHealth, rollupHealth, type HealthStatus,
} from '@/features/functions/health';

export const dynamic = 'force-dynamic';

const FUNCTION_ICONS: Record<string, LucideIcon> = {
  wishlist: Heart,
  'recently-viewed': Eye,
  'gift-registry': Gift,
  'save-for-later': Bookmark,
};

const STATUS_META: Record<HealthStatus, { label: string; icon: LucideIcon; pill: string; chip: string }> = {
  healthy: {
    label: 'Healthy',
    icon: CircleCheck,
    pill: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    chip: 'bg-emerald-500',
  },
  quiet: {
    label: 'Quiet',
    icon: CircleHelp,
    pill: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
    chip: 'bg-amber-500',
  },
  silent: {
    label: 'Silent',
    icon: CircleAlert,
    pill: 'bg-rose-500/10 text-rose-700 dark:text-rose-400',
    chip: 'bg-rose-500',
  },
  never: {
    label: 'Never',
    icon: CircleX,
    pill: 'bg-rose-600/10 text-rose-800 dark:text-rose-400',
    chip: 'bg-rose-600',
  },
};

function functionDisplay(key: string): string {
  return FUNCTIONS.find((f) => f.key === key)?.name ?? key;
}

function explain(status: HealthStatus): string {
  switch (status) {
    case 'never':
      return 'Toggled on but no event has ever been recorded. The embed script likely isn’t loading.';
    case 'silent':
      return 'No event in the last two weeks. The theme may have lost the script tag.';
    case 'quiet':
      return 'No event in the last week. Normal for low-traffic stores; worth a peek.';
    case 'healthy':
      return 'Recent activity within the last 7 days.';
  }
}

function formatRelative(d: Date | null): string {
  if (!d) return 'never';
  const days = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

export default async function FunctionsHealthPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_functions')) {
    return <div className="px-6 py-16 text-center"><h1 className="text-3xl">Forbidden</h1></div>;
  }

  const rows = await getFunctionHealth();
  const rollup = rollupHealth(rows);

  const grouped = rows.reduce<Record<string, typeof rows>>((acc, row) => {
    (acc[row.functionKey] ||= []).push(row);
    return acc;
  }, {});

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-10">
      <Link
        href="/f/functions"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="size-4" />
        Functions
      </Link>

      <header className="space-y-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1.5">
          <Activity className="size-3.5" />
          Health
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">Function health</h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Every store with a function toggled on, classified by whether it has
          recorded activity recently. &ldquo;Never&rdquo; or &ldquo;silent&rdquo;
          usually means the embed script isn&rsquo;t loading on that
          storefront &mdash; check the theme code.
        </p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <RollupTile status="healthy" count={rollup.healthy} total={rollup.total} />
        <RollupTile status="quiet" count={rollup.quiet} total={rollup.total} />
        <RollupTile status="silent" count={rollup.silent} total={rollup.total} />
        <RollupTile status="never" count={rollup.never} total={rollup.total} />
      </div>

      {rollup.needsAttention === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground space-y-2">
            <CircleCheck className="size-8 text-emerald-500 mx-auto" />
            <p>Every active function is producing events.</p>
          </CardContent>
        </Card>
      ) : (
        FUNCTIONS.map((fn) => {
          const fnRows = grouped[fn.key] ?? [];
          if (fnRows.length === 0) return null;
          const FnIcon = FUNCTION_ICONS[fn.key] ?? Activity;
          return (
            <Card key={fn.key}>
              <CardContent className="p-0">
                <div className="px-5 py-3 border-b border-border flex items-center justify-between">
                  <h2 className="text-sm font-semibold inline-flex items-center gap-2">
                    <FnIcon className={`size-4 ${fn.accent.fg}`} />
                    {fn.name}
                  </h2>
                  <Badge variant="outline" className="h-5 text-[10px] uppercase tracking-wider">
                    {fnRows.length} active
                  </Badge>
                </div>
                <ul className="divide-y divide-border">
                  {fnRows.map((r) => {
                    const meta = STATUS_META[r.status];
                    const StatusIcon = meta.icon;
                    return (
                      <li key={`${r.functionKey}-${r.storeId}`} className="px-5 py-3 flex items-center gap-4">
                        <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md ${meta.pill} shrink-0`}>
                          <StatusIcon className="size-3.5" />
                          <span className="text-[11px] font-semibold uppercase tracking-wider">{meta.label}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm truncate">{r.storeName}</div>
                          <div className="text-xs text-muted-foreground truncate">
                            {explain(r.status)}
                          </div>
                        </div>
                        <div className="text-[11px] text-muted-foreground font-mono tabular-nums shrink-0 text-right">
                          Last seen: {formatRelative(r.lastEventAt)}
                        </div>
                        <Link
                          href={`${fn.routes.admin}/${r.storeId}`}
                          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 shrink-0"
                        >
                          Open
                          <ExternalLink className="size-3" />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}

function RollupTile({
  status, count, total,
}: { status: HealthStatus; count: number; total: number }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <Card>
      <CardContent className="p-5 space-y-1.5">
        <div className={`inline-flex items-center gap-1.5 text-xs uppercase tracking-wider px-2 py-1 rounded-md ${meta.pill}`}>
          <Icon className="size-3.5" />
          {meta.label}
        </div>
        <div className="text-2xl font-semibold tabular-nums">{count.toLocaleString()}</div>
        <div className="text-xs text-muted-foreground tabular-nums">{pct}% of active</div>
      </CardContent>
    </Card>
  );
}

export const metadata = {
  title: 'Function health',
};
