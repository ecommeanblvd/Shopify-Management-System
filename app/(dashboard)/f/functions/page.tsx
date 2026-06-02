import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Heart, Gift, Bell, TrendingDown, Sparkles, Eye, Bookmark, ChevronRight, Power, Activity, Layers, ScrollText } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { FUNCTIONS } from '@/lib/registry/functions';
import { getAllFunctionsActivity, rollup } from '@/features/functions/registry-stats';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

const ICONS: Record<string, LucideIcon> = {
  Heart, Gift, Bell, TrendingDown, Sparkles, Eye, Bookmark,
};

export default async function FunctionsOverviewPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_functions')) {
    return (
      <div className="px-6 py-16 text-center">
        <h1 className="text-3xl">Forbidden</h1>
      </div>
    );
  }

  const stats = await getAllFunctionsActivity();
  const totals = rollup(stats);
  const busiest = totals.busiestFunctionKey
    ? FUNCTIONS.find((f) => f.key === totals.busiestFunctionKey)
    : null;

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-10">
      <header className="space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-3">
            <div className="text-xs uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1.5">
              <Sparkles className="size-3.5" />
              Functions
            </div>
            <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">
              Storefront functions
            </h1>
            <p className="text-sm text-muted-foreground max-w-xl">
              Pluggable, storefront-facing features the operator can apply to any
              connected Shopify store. Each function ships a customer-facing
              experience (e.g. wishlist heart icon, gift registry) plus the
              analytics + automations to support it.
            </p>
          </div>
          <Link
            href="/f/functions/audit"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 rounded-md border border-border shrink-0"
          >
            <ScrollText className="size-3.5" />
            Audit log
          </Link>
        </div>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <RollupTile
          icon={<Power className="size-4" />}
          label="Total activations"
          value={totals.totalActivations.toLocaleString()}
          sub={`${FUNCTIONS.length} functions × stores`}
        />
        <RollupTile
          icon={<Activity className="size-4" />}
          label="Events — last 7 days"
          value={totals.totalEvents7d.toLocaleString()}
          sub="across all functions"
        />
        <RollupTile
          icon={<Layers className="size-4" />}
          label="Busiest function"
          value={busiest ? busiest.name : 'None yet'}
          sub={busiest ? `${stats.get(busiest.key)?.last7DaysEvents.toLocaleString() ?? '0'} events` : 'no activity this week'}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {FUNCTIONS.map((fn) => {
          const Icon = ICONS[fn.icon];
          const s = stats.get(fn.key);
          const activeCount = s?.activeStoreCount ?? 0;
          const events = s?.last7DaysEvents ?? 0;
          return (
            <Link key={fn.key} href={fn.routes.admin} className="block group">
              <Card className="h-full transition-colors hover:bg-muted/30">
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className={`size-10 rounded-xl flex items-center justify-center shrink-0 ${fn.accent.bg} ${fn.accent.fg}`}>
                      <Icon className="size-5" />
                    </div>
                    <ChevronRight className="size-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold">{fn.name}</h2>
                    <p className="text-[10px] font-mono text-muted-foreground/80 mt-0.5">
                      v{fn.version}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {fn.description}
                  </p>
                  <div className="flex items-center gap-2 pt-1">
                    <Badge variant={activeCount > 0 ? 'secondary' : 'outline'} className="h-5 text-[10px] gap-1 px-1.5">
                      <Power className="size-2.5" />
                      {activeCount > 0 ? `${activeCount} active` : 'inactive'}
                    </Badge>
                    <Badge variant="outline" className="h-5 text-[10px] gap-1 px-1.5 font-mono tabular-nums">
                      <Activity className="size-2.5" />
                      {events.toLocaleString()} / 7d
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function RollupTile({
  icon, label, value, sub,
}: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <Card>
      <CardContent className="p-5 space-y-1.5">
        <div className="text-muted-foreground text-xs uppercase tracking-wider inline-flex items-center gap-1.5">
          {icon}
          {label}
        </div>
        <div className="text-2xl font-semibold tabular-nums truncate">{value}</div>
        <div className="text-xs text-muted-foreground">{sub}</div>
      </CardContent>
    </Card>
  );
}
