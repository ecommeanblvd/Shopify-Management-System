import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { ChevronLeft, Bookmark, Package, Users as UsersIcon, Layers, Activity, Code2, Download, BarChart3 } from 'lucide-react';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { getEnv } from '@/lib/env';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SaveForLaterInstallSnippet } from '@/components/functions/SaveForLaterInstallSnippet';
import { DailyTrendChart } from '@/components/functions/DailyTrendChart';
import {
  getSaveForLaterSummary, getTopSavedProducts,
} from '@/features/functions/save-for-later/admin-actions';
import { getDailyTrend } from '@/features/functions/daily-trend';

export const dynamic = 'force-dynamic';

export default async function SaveForLaterStorePage({
  params,
}: {
  params: Promise<{ storeId: string }>;
}) {
  const { storeId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_functions')) {
    return <div className="px-6 py-16 text-center"><h1 className="text-3xl">Forbidden</h1></div>;
  }

  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId));
  if (!store) notFound();

  const trendDays = 7;
  const [summary, topSaved, trend] = await Promise.all([
    getSaveForLaterSummary(storeId),
    getTopSavedProducts(storeId, 10),
    getDailyTrend('save_for_later', storeId, trendDays),
  ]);

  const embedUrl = `${getEnv().SHOPIFY_APP_URL.replace(/\/$/, '')}/api/storefront/save-for-later/embed`;

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-10">
      <Link
        href="/f/functions/save-for-later"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="size-4" />
        Save for later
      </Link>

      <header className="space-y-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1.5">
          <Bookmark className="size-3.5" />
          {store.name}
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">Save for later analytics</h1>
        <p className="text-sm text-muted-foreground font-mono">{store.shopDomain}</p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile icon={<Layers className="size-4" />} label="Items saved" value={summary.itemCount.toLocaleString()} sub="currently stashed" />
        <Tile icon={<Package className="size-4" />} label="Unique products" value={summary.uniqueProducts.toLocaleString()} sub="distinct SKUs" />
        <Tile icon={<UsersIcon className="size-4" />} label="Unique devices" value={summary.uniqueDevices.toLocaleString()} sub="approx. shoppers" />
        <Tile icon={<Activity className="size-4" />} label="Last 7 days" value={summary.last7Days.toLocaleString()} sub="new saves" />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-semibold inline-flex items-center gap-2">
              <BarChart3 className="size-4 text-muted-foreground" />
              Saves — last {trendDays} days
            </h2>
            <Badge variant="outline" className="h-5 text-[10px] uppercase tracking-wider">
              {trend.reduce((a, b) => a + b.count, 0).toLocaleString()}
            </Badge>
          </div>
          <DailyTrendChart
            buckets={trend}
            accentClass="bg-violet-500"
            emptyLabel={`No saves recorded in the last ${trendDays} days yet.`}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5 space-y-5">
          <div className="flex items-center gap-2">
            <Code2 className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Storefront install</h2>
          </div>
          <SaveForLaterInstallSnippet shopDomain={store.shopDomain} embedUrl={embedUrl} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-semibold">Top saved products</h2>
            <div className="flex items-center gap-3">
              <a
                href={`/f/functions/save-for-later/${storeId}/export.csv`}
                className="text-[11px] inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                title="Download all saved items as CSV"
              >
                <Download className="size-3" />
                Export CSV
              </a>
              <Badge variant="outline" className="h-5 text-[10px] uppercase tracking-wider">
                {topSaved.length}
              </Badge>
            </div>
          </div>
          {topSaved.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-muted-foreground">
              No saves logged yet. Once shoppers start using the &ldquo;Save for later&rdquo; link, the top-N list shows here.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {topSaved.map((p, i) => (
                <li key={p.productId} className="px-5 py-3 flex items-center gap-4">
                  <span className="text-xs font-mono tabular-nums text-muted-foreground w-6 text-right">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{p.productTitle}</div>
                    <div className="text-xs text-muted-foreground font-mono truncate">{p.productHandle}</div>
                  </div>
                  <span className="font-mono tabular-nums text-sm font-semibold">{p.saves}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Tile({
  icon, label, value, sub,
}: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <Card>
      <CardContent className="p-5 space-y-1.5">
        <div className="text-muted-foreground text-xs uppercase tracking-wider inline-flex items-center gap-1.5">
          {icon}
          {label}
        </div>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        <div className="text-xs text-muted-foreground">{sub}</div>
      </CardContent>
    </Card>
  );
}
