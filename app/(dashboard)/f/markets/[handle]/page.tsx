import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { eq } from 'drizzle-orm';
import { ChevronLeft, Globe2, Coins, Languages, Store, Trash2, ArrowRight, Sparkles } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { db, schema } from '@/db/client';
import { listTemplates, saveTemplate, deleteTemplate } from '@/features/markets/actions';
import { MarketForm } from '@/components/markets/MarketForm';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import type { Market } from '@/features/markets/types';

export const dynamic = 'force-dynamic';

export default async function MarketDetailPage({
  params,
}: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/auth/sign-in');
  const role = await getRole(session.user.id);
  if (!hasPermission(role, 'view_markets_history')) {
    return <div className="p-8">Forbidden</div>;
  }

  const all = await listTemplates();
  const market = all.find((m) => m.handle === handle);
  if (!market) notFound();
  const canManage = hasPermission(role, 'manage_markets_template');

  const stores = await db.select().from(schema.stores);
  const overrides = await db.select().from(schema.marketStoreOverrides)
    .where(eq(schema.marketStoreOverrides.marketHandle, handle));
  const overrideByStore = new Map(overrides.map((o) => [o.storeId, o] as const));

  async function handleSubmit(m: Market) {
    'use server';
    const s = await auth.api.getSession({ headers: await headers() });
    if (!s) throw new Error('unauthenticated');
    await saveTemplate(m, s.user.id);
  }

  async function handleDelete() {
    'use server';
    const s = await auth.api.getSession({ headers: await headers() });
    if (!s) throw new Error('unauthenticated');
    const r = await getRole(s.user.id);
    if (!hasPermission(r, 'manage_markets_template')) throw new Error('forbidden');
    await deleteTemplate(handle);
    redirect('/f/markets');
  }

  const storesWithOverrides = stores.filter((s) => overrideByStore.has(s.id)).length;

  return (
    <div className="max-w-6xl mx-auto px-6 md:px-10 py-8 md:py-12 space-y-10">
      {/* Breadcrumb */}
      <Link
        href="/f/markets"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="size-4" />
        All markets
      </Link>

      {/* Hero */}
      <header className="space-y-6">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div className="space-y-3 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">{market.name}</h1>
              <Badge
                variant={market.enabled ? 'default' : 'outline'}
                className="h-7 px-3 text-xs uppercase tracking-wider"
              >
                {market.enabled ? 'Live' : 'Disabled'}
              </Badge>
            </div>
            <div className="text-sm text-muted-foreground font-mono">{market.handle}</div>
          </div>
          {canManage && (
            <form action={handleDelete}>
              <Button
                type="submit"
                variant="ghost"
                className="text-destructive hover:text-destructive hover:bg-destructive/10 gap-2"
              >
                <Trash2 className="size-4" />
                Delete market
              </Button>
            </form>
          )}
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border rounded-2xl overflow-hidden border border-border">
          <StatTile
            icon={<Globe2 className="size-4" />}
            label="Type"
            value={market.type === 'regional' ? 'Regional' : 'International'}
            sub={market.type === 'regional'
              ? `${market.countries.length} ${market.countries.length === 1 ? 'country' : 'countries'}`
              : 'Catch-all'}
          />
          <StatTile
            icon={<Coins className="size-4" />}
            label="Currencies"
            value={market.primaryCurrency}
            sub={market.alternativeCurrencies.length > 0
              ? `+ ${market.alternativeCurrencies.join(', ')}`
              : 'No alternates'}
          />
          <StatTile
            icon={<Languages className="size-4" />}
            label="Languages"
            value={market.primaryLanguage.toUpperCase()}
            sub={market.alternativeLanguages.length > 0
              ? `+ ${market.alternativeLanguages.map((l) => l.toUpperCase()).join(', ')}`
              : 'No alternates'}
          />
          <StatTile
            icon={<Store className="size-4" />}
            label="Stores"
            value={`${storesWithOverrides}/${stores.length}`}
            sub={storesWithOverrides === 0 ? 'No overrides' : `${storesWithOverrides} customized`}
          />
        </div>
      </header>

      {/* Template form */}
      <Card>
        <CardContent className="p-6 md:p-10">
          <div className="mb-8 flex items-center gap-3">
            <div className="size-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <Sparkles className="size-4" />
            </div>
            <div>
              <h2 className="text-xl font-semibold tracking-tight">Template</h2>
              <p className="text-sm text-muted-foreground">
                The baseline definition. Per-store overrides extend or replace specific fields.
              </p>
            </div>
          </div>
          {canManage ? (
            <MarketForm initial={market} isNew={false} onSubmit={handleSubmit} />
          ) : (
            <pre className="bg-muted p-4 rounded-lg text-xs overflow-x-auto">
              {JSON.stringify(market, null, 2)}
            </pre>
          )}
        </CardContent>
      </Card>

      {/* Per-store overrides */}
      <Card>
        <CardContent className="p-6 md:p-10">
          <div className="mb-8 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="size-9 rounded-xl bg-secondary text-secondary-foreground flex items-center justify-center">
                <Store className="size-4" />
              </div>
              <div>
                <h2 className="text-xl font-semibold tracking-tight">Per-store overrides</h2>
                <p className="text-sm text-muted-foreground">
                  Adjust price, shipping zones, or rates for a specific store.
                </p>
              </div>
            </div>
            {stores.length > 0 && (
              <Badge variant="outline" className="h-6">
                {storesWithOverrides} of {stores.length} customized
              </Badge>
            )}
          </div>

          {stores.length === 0 ? (
            <EmptyState
              title="No stores connected yet"
              hint="Connect a store from the Stores page to enable per-store overrides."
            />
          ) : (
            <ul className="space-y-2">
              {stores.map((s) => {
                const o = overrideByStore.get(s.id);
                const hasAdj = !!(o && o.priceAdjustment);
                const adjValue = hasAdj ? (o!.priceAdjustment as { value: number }).value : null;
                const zoneCount = (o?.shipping as { zones?: object } | null | undefined)?.zones
                  ? Object.keys((o!.shipping as { zones: object }).zones).length
                  : 0;
                const customized = hasAdj || zoneCount > 0;

                return (
                  <li key={s.id}>
                    <Link
                      href={`/f/markets/${handle}/stores/${s.id}`}
                      className="group flex items-center justify-between gap-4 rounded-xl border border-border hover:border-foreground/20 hover:bg-muted/40 transition-colors px-5 py-4"
                    >
                      <div className="flex items-center gap-4 min-w-0">
                        <span
                          className={
                            'size-2 rounded-full shrink-0 ' +
                            (customized ? 'bg-emerald-500' : 'bg-muted-foreground/30')
                          }
                          aria-hidden
                        />
                        <div className="min-w-0">
                          <div className="font-medium truncate">{s.name}</div>
                          <div className="text-xs text-muted-foreground font-mono truncate">{s.shopDomain}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap justify-end">
                        {hasAdj ? (
                          <Badge variant="secondary" className="h-6">
                            {adjValue! > 0 ? '+' : ''}{adjValue}% price
                          </Badge>
                        ) : null}
                        {zoneCount > 0 ? (
                          <Badge variant="secondary" className="h-6">
                            {zoneCount} {zoneCount === 1 ? 'zone' : 'zones'}
                          </Badge>
                        ) : null}
                        {!customized && (
                          <span className="text-xs text-muted-foreground">Uses template</span>
                        )}
                        <ArrowRight className="size-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Separator />
      <p className="text-xs text-muted-foreground text-center">
        Changes to this template are not pushed to stores until you run <span className="font-mono">Apply</span> from the Markets list.
      </p>
    </div>
  );
}

function StatTile({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="bg-card p-5 space-y-2">
      <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wider">
        {icon}
        {label}
      </div>
      <div className="text-2xl font-semibold tracking-tight">{value}</div>
      <div className="text-xs text-muted-foreground truncate">{sub}</div>
    </div>
  );
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="text-center py-12 border border-dashed border-border rounded-xl">
      <div className="text-sm font-medium">{title}</div>
      <div className="text-xs text-muted-foreground mt-1">{hint}</div>
    </div>
  );
}
