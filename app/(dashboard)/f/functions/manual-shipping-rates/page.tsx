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
import { classifyFeeCoverage, type FeeCoverageResult } from '@/features/carrier-rates/push/fee-coverage';
import { ApplyBackupButton } from '@/components/functions/ApplyBackupButton';

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

  // Khoản phí CÓ/KHÔNG cover của từng carrier (suy từ cấu hình surcharge active).
  // Key theo carrier brand ('fedex'/'dhl') để client khớp với tab đang chọn.
  const carrierAccts = await db
    .select({ id: schema.carrierAccounts.id, name: schema.carrierAccounts.name, key: schema.carriers.key })
    .from(schema.carrierAccounts)
    .innerJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId));
  const coverage: Record<string, FeeCoverageResult> = {};
  for (const a of carrierAccts) {
    const surs = await db
      .select({ kind: schema.carrierSurcharges.kind, active: schema.carrierSurcharges.active, applyMode: schema.carrierSurcharges.applyMode, value: schema.carrierSurcharges.value, stepKg: schema.carrierSurcharges.stepKg, startsAt: schema.carrierSurcharges.startsAt, endsAt: schema.carrierSurcharges.endsAt })
      .from(schema.carrierSurcharges)
      .where(eq(schema.carrierSurcharges.carrierAccountId, a.id));
    if (a.key) coverage[a.key] = classifyFeeCoverage(surs.map((s) => ({ kind: s.kind, active: s.active, applyMode: s.applyMode as 'always' | 'when_billed', value: Number(s.value), stepKg: s.stepKg != null ? Number(s.stepKg) : null, startsAt: s.startsAt, endsAt: s.endsAt })) as never, a.name);
  }

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
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <Link href="/f/functions" className="text-sm text-muted-foreground hover:text-foreground">← Functions</Link>
          <h1 className="text-xl font-semibold tracking-tight">Manual Shipping rates</h1>
          <span className="text-xs text-muted-foreground">Bảng giá current (flat, zone × bậc cân) với fuel đang áp — backup khi carrier API gãy.</span>
        </div>
        {canApply && stores.length > 0 && (
          <ApplyBackupButton stores={stores} storeCount={activeStoreCount} onPreview={preview} onApply={apply} onApplyAll={applyAll} />
        )}
      </div>

      {stores.length === 0 ? (
        <div className="rounded-md border border-border p-4 text-sm text-muted-foreground">Chưa có store nào kết nối.</div>
      ) : (
        <>
          {markets.length === 0 ? (
            <p className="text-sm text-muted-foreground">Store này chưa có cấu hình market/giá ship.</p>
          ) : (
            <ManualRatesBrowser markets={markets} coverage={coverage} />
          )}
        </>
      )}
    </div>
  );
}
