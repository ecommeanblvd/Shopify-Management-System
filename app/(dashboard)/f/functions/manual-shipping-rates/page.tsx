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
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-8">
      <Link href="/f/functions" className="text-sm text-muted-foreground hover:text-foreground">← Functions</Link>
      <div>
        <h1 className="text-4xl font-semibold tracking-tight">Manual Shipping rates</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Bảng giá ship flat (theo zone × bậc cân) đang cấu hình cho từng store — đây là rate
          backup Shopify dùng khi API FedEx/DHL gãy. Apply để đẩy lại lên Shopify khi cần.
        </p>
      </div>

      {stores.length === 0 ? (
        <div className="rounded-md border border-border p-4 text-sm text-muted-foreground">Chưa có store nào kết nối.</div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {stores.map((s) => (
              <Link key={s.id} href={`/f/functions/manual-shipping-rates?store=${s.id}`}
                className={`rounded border px-3 py-1 text-sm ${s.id === activeId ? 'border-foreground font-medium' : 'border-border text-muted-foreground hover:bg-muted'}`}>
                {s.name}
              </Link>
            ))}
          </div>

          {canApply && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
              <p className="mb-2 text-amber-700 dark:text-amber-400">
                Apply đẩy <strong>toàn bộ cấu hình market</strong> của store lên Shopify (gồm flat rates). Dùng khi carrier API gãy.
              </p>
              <div className="mb-3 border-b border-amber-500/30 pb-3">
                <p className="mb-2 text-xs font-medium uppercase tracking-wider text-amber-700/80 dark:text-amber-400/80">Khẩn cấp — apply hàng loạt</p>
                <ApplyAllBackupButton storeCount={activeStoreCount} onApplyAll={applyAll} />
              </div>
              <p className="mb-2 text-xs text-muted-foreground">Hoặc apply từng store:</p>
              <ApplyModal stores={stores} onPreview={preview} onApply={apply} />
            </div>
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
