import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { ChevronLeft, Send, AlertCircle, CheckCircle2, ArrowRight, Store, Fuel } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { getAccount } from '@/features/carrier-rates/actions';
import { buildPushPlan, commitPushPlan } from '@/features/carrier-rates/push/commit';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

function formatDisplay(n: number, currency: string): string {
  if (!Number.isFinite(n)) return '—';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

export default async function PushPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_carrier_rates')) {
    return <div className="max-w-3xl mx-auto px-6 md:px-10 py-16 text-center"><h1 className="text-3xl font-semibold">Forbidden</h1></div>;
  }
  const account = await getAccount(id);
  if (!account) notFound();

  const canPush = hasPermission(role, 'manage_carrier_rates') && hasPermission(role, 'apply_markets');
  const plan = await buildPushPlan(id);

  async function commitAction() {
    'use server';
    const s = await auth.api.getSession({ headers: await headers() });
    if (!s) throw new Error('unauthenticated');
    const r = await getRole(s.user.id);
    if (!r || !hasPermission(r, 'manage_carrier_rates') || !hasPermission(r, 'apply_markets')) {
      throw new Error('forbidden');
    }
    const result = await commitPushPlan(id, s.user.id);
    revalidatePath(`/f/carrier-rates/${id}/push`);
    revalidatePath('/f/markets');
    redirect(`/f/carrier-rates/${id}/push?committed=${result.marketsWritten}-${result.storesAffected}-${result.ratesEmitted}`);
  }

  // Group rows by market so the preview reads top-down
  const byMarket = new Map<string, typeof plan.rows>();
  for (const row of plan.rows) {
    const list = byMarket.get(row.marketHandle) ?? [];
    list.push(row);
    byMarket.set(row.marketHandle, list);
  }

  const totalStores = new Set(plan.rows.map((r) => r.storeId)).size;
  const totalZones = plan.rows.reduce((sum, r) => sum + r.zones.length, 0);
  const totalRates = plan.rows.reduce(
    (sum, r) => sum + r.zones.reduce((s, z) => s + z.rates.length, 0),
    0,
  );
  const totalWarnings = plan.rows.reduce(
    (sum, r) => sum + r.zones.reduce(
      (s, z) => s + z.rates.filter((rt) => rt.warning).length,
      0,
    ),
    0,
  );

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-10">
      <Link href={`/f/carrier-rates/${id}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ChevronLeft className="size-4" />
        {account.name}
      </Link>

      <header className="space-y-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Send className="size-3.5" />
          Recalculate &amp; push
        </div>
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">Push to Markets</h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Recompute every (market × store × tier) using the current rate matrix, surcharges, and FX,
          then stage the results into the per-store Markets override. Apply pushes them to Shopify
          on the next Markets apply run — this page does NOT call Shopify directly.
        </p>
      </header>

      {/* Stats */}
      <div className="grid grid-cols-5 gap-px bg-border rounded-2xl overflow-hidden border border-border">
        <StatTile label="Markets" value={String(byMarket.size)} sub="Linked" />
        <StatTile label="Stores" value={String(totalStores)} sub="Active" />
        <StatTile label="Zones" value={String(totalZones)} sub="Shopify zones" />
        <StatTile label="Rates" value={String(totalRates)} sub="To stage" />
        <StatTile label="Warnings" value={String(totalWarnings)} sub={totalWarnings === 0 ? 'Clean' : 'Skipped quotes'} tone={totalWarnings > 0 ? 'warning' : 'default'} />
      </div>

      {/* Fuel đang bake vào bảng giá — giá tĩnh nên khoá theo ngày push. */}
      {plan.fuelPercent !== null && (
        <div className="rounded-xl border border-sky-200 dark:border-sky-900/60 bg-sky-50 dark:bg-sky-950/30 text-sky-900 dark:text-sky-100 px-5 py-4 flex items-start gap-3 text-sm">
          <Fuel className="size-4 shrink-0 mt-0.5" />
          <div>
            Bảng giá bên dưới đang bake phụ phí xăng dầu{' '}
            <span className="font-semibold">{plan.fuelPercent}%</span> (mức FedEx hiệu lực hôm nay).
            <span className="text-sky-700 dark:text-sky-300">
              {' '}FedEx đổi fuel theo tuần — nếu lệch nhiều so với lần push trước, hãy push lại để
              giá khách bám fuel thật.
            </span>
          </div>
        </div>
      )}

      {plan.warnings.length > 0 && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-100 px-5 py-4 flex items-start gap-3 text-sm">
          <AlertCircle className="size-4 shrink-0 mt-0.5" />
          <div className="space-y-1">
            {plan.warnings.map((w, i) => <div key={i}>{w}</div>)}
          </div>
        </div>
      )}

      {plan.rows.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Store className="size-8 mx-auto text-muted-foreground mb-3" />
            <div className="text-sm font-medium">Nothing to push yet</div>
            <div className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
              Link this carrier account to at least one market via the market detail page, then
              come back to recompute the rate matrix into per-store overrides.
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {Array.from(byMarket.entries()).map(([handle, rows]) => (
            <Card key={handle}>
              <CardContent className="p-6 md:p-8">
                <div className="flex items-center justify-between gap-3 flex-wrap mb-5">
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold tracking-tight">{rows[0].marketName}</h2>
                    <div className="text-xs text-muted-foreground font-mono">{handle}</div>
                  </div>
                  <Badge variant="outline" className="h-6">
                    {rows.length} {rows.length === 1 ? 'store' : 'stores'}
                  </Badge>
                </div>
                <ul className="space-y-4">
                  {rows.map((r) => (
                    <li key={r.storeId} className="rounded-xl border border-border px-4 py-4 space-y-4">
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="font-medium text-sm">{r.storeName}</div>
                        <div className="text-xs text-muted-foreground">
                          {r.currentZoneNames.length === 0
                            ? <span className="italic">No existing auto-zones — fresh insert</span>
                            : <>Existing: <span className="font-mono">{r.currentZoneNames.length}</span> auto-zone{r.currentZoneNames.length === 1 ? '' : 's'} will be replaced</>}
                        </div>
                      </div>
                      <div className="space-y-3">
                        {r.zones.map((z) => (
                          <div key={z.zoneName} className="rounded-lg border border-border/70 bg-muted/20 px-3 py-3 space-y-2">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <div className="text-sm font-semibold tracking-tight">{z.zoneName}</div>
                              <div className="text-[11px] text-muted-foreground">
                                {z.countries.length} {z.countries.length === 1 ? 'country' : 'countries'}
                                {' · '}
                                {z.rates.length} {z.rates.length === 1 ? 'rate' : 'rates'}
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {z.countries.map((c) => (
                                <span key={c} className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-card border border-border/60 text-foreground/80">
                                  {c}
                                </span>
                              ))}
                            </div>
                            <details className="mt-1">
                              <summary className="text-[11px] text-muted-foreground hover:text-foreground cursor-pointer select-none">
                                Show {z.rates.length} rates
                              </summary>
                              <div className="flex flex-wrap gap-1.5 mt-2">
                                {z.rates.map((rt) => (
                                  <RatePill
                                    key={rt.name}
                                    name={rt.name}
                                    price={rt.price}
                                    currency={account.displayCurrency}
                                    warning={rt.warning}
                                  />
                                ))}
                              </div>
                            </details>
                          </div>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}

          {canPush ? (
            <form action={commitAction}>
              <Card className="border-primary/40 bg-primary/[0.03]">
                <CardContent className="p-6 md:p-8 flex items-center justify-between gap-4 flex-wrap">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold tracking-tight">Ready to commit</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Writes <span className="font-mono">{totalRates}</span> rate{totalRates === 1 ? '' : 's'}
                      {' '}across <span className="font-mono">{totalZones}</span> zone{totalZones === 1 ? '' : 's'} ·
                      {' '}<span className="font-mono">{byMarket.size}</span> market{byMarket.size === 1 ? '' : 's'} ×
                      {' '}<span className="font-mono">{totalStores}</span> store{totalStores === 1 ? '' : 's'} into
                      {' '}<span className="font-mono">market_store_overrides.shipping</span>.
                      Manually-authored zones with other names are preserved.
                    </div>
                  </div>
                  <Button type="submit" size="lg" className="gap-2 shrink-0">
                    <Send className="size-4" />
                    Commit push
                  </Button>
                </CardContent>
              </Card>
            </form>
          ) : (
            <p className="text-xs text-muted-foreground italic text-center">
              Read-only view. Commit requires both <span className="font-mono">manage_carrier_rates</span> and <span className="font-mono">apply_markets</span> permissions.
            </p>
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground text-center inline-flex items-center gap-1.5 justify-center w-full">
        <CheckCircle2 className="size-3.5" />
        After commit, run <Link href="/f/markets/apply" className="underline">Markets apply</Link> to push the new rates to Shopify.
        <ArrowRight className="size-3" />
      </p>
    </div>
  );
}

function StatTile({
  label, value, sub, tone = 'default',
}: { label: string; value: string; sub: string; tone?: 'default' | 'warning' }) {
  const c = tone === 'warning' ? 'text-amber-600 dark:text-amber-500' : '';
  return (
    <div className="bg-card p-5 space-y-1.5">
      <div className="text-muted-foreground text-xs uppercase tracking-wider">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums ${c}`}>{value}</div>
      <div className="text-xs text-muted-foreground truncate">{sub}</div>
    </div>
  );
}

function RatePill({
  name, price, currency, warning,
}: { name: string; price: number; currency: string; warning: string | null }) {
  if (warning) {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 text-[11px] px-2 py-1" title={warning}>
        <AlertCircle className="size-3" />
        <span className="font-medium">{name}</span>
        <span className="opacity-70">·</span>
        <span className="italic">{warning}</span>
      </div>
    );
  }
  return (
    <div className="inline-flex items-center gap-2 rounded-md border border-border bg-card text-[11px] px-2 py-1">
      <span className="font-medium">{name}</span>
      <span className="font-mono tabular-nums text-foreground/80">{formatDisplay(price, currency)}</span>
    </div>
  );
}
