import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { listOverridesForStore, previewMarketsApply, executeMarketsApply, executeMarketsApplyAll } from '@/features/markets/actions';
import { flattenShippingMatrix } from '@/features/markets/domain/shipping-matrix-view';
import { ManualRatesBrowser, type MarketZones } from '@/components/functions/ManualRatesBrowser';
import { ApplyModal } from '@/components/markets/ApplyModal';
import { ApplyAllBackupButton } from '@/components/functions/ApplyAllBackupButton';

export const dynamic = 'force-dynamic';

export default async function ManualShippingRatesPage({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_markets_history')) {
    return <div className="px-6 py-16 text-center"><h1 className="text-3xl">Forbidden</h1></div>;
  }
  const canApply = hasPermission(role, 'apply_markets');

  const stores = (await db.select().from(schema.stores))
    .map((s) => ({ id: s.id, name: s.name, shopDomain: s.shopDomain }));
  const activeStores = await db.select({ id: schema.stores.id }).from(schema.stores)
    .where(and(eq(schema.stores.status, 'active'), eq(schema.stores.maintenanceMode, false)));
  const activeStoreCount = activeStores.length;
  const sp = await searchParams;
  const activeId = stores.find((s) => s.id === sp.store)?.id ?? stores[0]?.id ?? null;
  const overrides = activeId ? await listOverridesForStore(activeId) : [];
  const markets: MarketZones[] = overrides.map((o) => ({ marketHandle: o.marketHandle, zones: flattenShippingMatrix(o.shipping) }));

  async function preview(storeId: string) {
    'use server';
    const s = await auth.api.getSession({ headers: await headers() });
    if (!s) throw new Error('unauthenticated');
    const r = await previewMarketsApply(storeId);
    return { ops: r.ops };
  }
  async function apply(storeId: string) {
    'use server';
    const s = await auth.api.getSession({ headers: await headers() });
    if (!s) throw new Error('unauthenticated');
    const r = await executeMarketsApply(storeId, s.user.id);
    return { errors: r.kind === 'applied' ? r.errors : [] };
  }
  async function applyAll() {
    'use server';
    const s = await auth.api.getSession({ headers: await headers() });
    if (!s) throw new Error('unauthenticated');
    return executeMarketsApplyAll(s.user.id);
  }

  return (
    <div className="px-6 md:px-10 py-5 space-y-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Link href="/f/functions" className="text-sm text-muted-foreground hover:text-foreground">← Functions</Link>
        <h1 className="text-xl font-semibold tracking-tight">Manual Shipping rates</h1>
        <span className="text-xs text-muted-foreground">Giá ship flat (zone × bậc cân) — backup Shopify khi carrier API gãy.</span>
      </div>

      {stores.length === 0 ? (
        <div className="rounded-md border border-border p-4 text-sm text-muted-foreground">Chưa có store nào kết nối.</div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {stores.map((s) => (
              <Link key={s.id} href={`/f/functions/manual-shipping-rates?store=${s.id}`}
                className={`rounded border px-3 py-1 text-sm ${s.id === activeId ? 'border-foreground font-medium' : 'border-border text-muted-foreground hover:bg-muted'}`}>
                {s.name}
              </Link>
            ))}
          </div>

          {canApply && (
            <details className="rounded-md border border-amber-500/40 bg-amber-500/5 text-sm">
              <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium uppercase tracking-wider text-amber-700/90 dark:text-amber-400/90">
                ⚡ Apply backup lên Shopify (khẩn cấp khi carrier API gãy)
              </summary>
              <div className="space-y-3 px-3 pb-3">
                <div className="border-b border-amber-500/30 pb-3">
                  <p className="mb-2 text-xs text-muted-foreground">Apply hàng loạt — đẩy toàn bộ cấu hình market (gồm flat rates) lên tất cả store:</p>
                  <ApplyAllBackupButton storeCount={activeStoreCount} onApplyAll={applyAll} />
                </div>
                <div>
                  <p className="mb-2 text-xs text-muted-foreground">Hoặc apply từng store:</p>
                  <ApplyModal stores={stores} onPreview={preview} onApply={apply} />
                </div>
              </div>
            </details>
          )}

          {markets.length === 0 ? (
            <p className="text-sm text-muted-foreground">Store này chưa có cấu hình market/giá ship.</p>
          ) : (
            <ManualRatesBrowser markets={markets} />
          )}
        </>
      )}
    </div>
  );
}
