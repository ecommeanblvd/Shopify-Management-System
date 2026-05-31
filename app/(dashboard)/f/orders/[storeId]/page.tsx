import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { eq, sql } from 'drizzle-orm';
import { Tag } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { db, schema } from '@/db/client';
import { getStoreMetrics } from '@/features/shopify-orders/dashboard-actions';
import { getOrderDetail, updateOrderOverrides } from '@/features/shopify-orders/order-actions';
import { startBackfill } from '@/features/shopify-orders/backfill/actions';
import { updateStoreCostFx } from '@/features/shopify-orders/cost-fx-actions';
import { Button } from '@/components/ui/button';
import { MetricsKpis } from '@/components/shopify-orders/MetricsKpis';
import { MetricsFilters } from '@/components/shopify-orders/MetricsFilters';
import { OrdersTable } from '@/components/shopify-orders/OrdersTable';
import { CostFxButton } from '@/components/shopify-orders/CostFxButton';
import { HealthPopover, type HealthSnapshot, type BackfillStatus } from '@/components/shopify-orders/HealthPopover';

export const dynamic = 'force-dynamic';

// Hard-coded per spec — only the MEAN store exposes a vendor filter in v1.
// Update this list (or move to a feature flag) when more stores need it.
const VENDOR_FILTER_DOMAINS = ['mean-store.myshopify.com'];

export default async function StoreOrders({
  params,
  searchParams,
}: {
  params: Promise<{ storeId: string }>;
  searchParams: Promise<{ from?: string; to?: string; vendor?: string }>;
}) {
  const { storeId } = await params;
  const sp = await searchParams;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_orders')) {
    return (
      <div className="px-6 py-16 text-center">
        <h1 className="text-3xl">Forbidden</h1>
      </div>
    );
  }

  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId));
  if (!store) notFound();

  // React 19's purity rule flags Date.now() during render. This is a server
  // component running once per request — the call is fine here. Suppress
  // the rule narrowly and snap the clock to one value used twice.
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();
  const dateTo = sp.to ? new Date(sp.to) : new Date(nowMs);
  const dateFrom = sp.from
    ? new Date(sp.from)
    : new Date(nowMs - 30 * 24 * 60 * 60 * 1000);
  const vendorFilter = sp.vendor?.split(',').filter(Boolean);

  const showVendor = VENDOR_FILTER_DOMAINS.includes(store.shopDomain);

  const { total, orders: orderList } = await getStoreMetrics({
    storeId,
    dateFrom,
    dateTo,
    vendorFilter: showVendor ? vendorFilter : undefined,
  });

  // Distinct vendors across all lines in the window. We re-query just the
  // vendor column rather than threading it through getStoreMetrics — keeps
  // the metrics API focused.
  const vendors = showVendor
    ? await db
        .selectDistinct({ vendor: schema.shopifyOrderLines.vendor })
        .from(schema.shopifyOrderLines)
        .innerJoin(
          schema.shopifyOrders,
          eq(schema.shopifyOrderLines.orderId, schema.shopifyOrders.id),
        )
        .where(eq(schema.shopifyOrders.storeId, storeId))
        .then((rows) =>
          rows
            .map((r) => r.vendor)
            .filter((v): v is string => !!v)
            .sort(),
        )
    : [];

  // Health snapshot — pre-format here so the client component stays
  // purely presentational (no DB import in client bundle).
  const [syncState] = await db
    .select()
    .from(schema.shopifySyncState)
    .where(eq(schema.shopifySyncState.storeId, storeId));
  const webhookCountsRes = await db.execute<{ ok: string; failed: string }>(sql`
    SELECT SUM(CASE WHEN status = 'processed' THEN 1 ELSE 0 END)::text AS ok,
           SUM(CASE WHEN status IN ('failed','rejected') THEN 1 ELSE 0 END)::text AS failed
      FROM shopify_webhook_log
     WHERE store_id = ${storeId} AND received_at > NOW() - INTERVAL '24 hours';
  `);
  const webhookCounts = webhookCountsRes.rows;
  const orderCountRes = await db.execute<{ n: string }>(sql`
    SELECT COUNT(*)::text AS n FROM shopify_orders WHERE store_id = ${storeId};
  `);
  const orderCount = Number(orderCountRes.rows[0]?.n ?? '0');

  const ago = (d: Date | null | undefined): string =>
    d ? `${Math.round((nowMs - new Date(d).getTime()) / 60000)} min ago` : '—';
  const duration = (a: Date | null, b: Date | null): string => {
    if (!a || !b) return '—';
    const secs = Math.round((new Date(b).getTime() - new Date(a).getTime()) / 1000);
    if (secs < 60) return `${secs} s`;
    if (secs < 3600) return `${Math.round(secs / 60)} min`;
    return `${(secs / 3600).toFixed(1)} h`;
  };

  // Narrow to the typed union; fallback to 'idle' for anything unrecognised so
  // the UI keeps rendering even if the DB ever carries an unexpected value.
  const ALLOWED: ReadonlySet<BackfillStatus> = new Set(['idle', 'running', 'done', 'failed']);
  const rawStatus = syncState?.backfillStatus ?? 'idle';
  const backfillStatus: BackfillStatus = ALLOWED.has(rawStatus as BackfillStatus)
    ? (rawStatus as BackfillStatus)
    : 'idle';

  const snapshot: HealthSnapshot = {
    lastWebhookAgo: ago(syncState?.lastWebhookAt),
    lastCronAgo: ago(syncState?.lastCronSyncAt),
    backfillStatus,
    backfillStartedAgo: ago(syncState?.backfillStartedAt),
    backfillFinishedAgo: ago(syncState?.backfillFinishedAt),
    backfillDurationLabel: duration(syncState?.backfillStartedAt ?? null, syncState?.backfillFinishedAt ?? null),
    backfillError: syncState?.backfillError ?? null,
    backfillCursor: syncState?.backfillCursor ?? null,
    ordersInDb: orderCount,
    webhooksOk: webhookCounts[0]?.ok ?? '0',
    webhooksFailed: webhookCounts[0]?.failed ?? '0',
  };

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-8">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-tight">{store.name}</h1>
          <p className="text-sm text-muted-foreground mt-1 font-mono">
            {store.shopDomain}
            {total.currency ? ` · ${total.currency}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {hasPermission(role, 'manage_stores') && (
            <CostFxButton
              storeId={storeId}
              orderCurrency={total.currency || 'USD'}
              initialCostCurrency={store.costCurrency}
              initialFxRate={store.fxCostPerOrderCurrency}
              initialPackagingFee={store.packagingFee}
              saveAction={updateStoreCostFx}
            />
          )}
          {hasPermission(role, 'manage_sku_costs') && (
            <Link href={`/f/orders/${storeId}/costs`}>
              <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 px-2.5 text-xs">
                <Tag className="size-3.5" />
                SKU costs
              </Button>
            </Link>
          )}
          {/*
            Shipping invoices are uploaded globally — one carrier invoice spans
            many stores. The Orders landing page (/f/orders) hosts the upload.
          */}
          <HealthPopover
            storeName={store.name}
            snapshot={snapshot}
            startBackfillAction={startBackfill.bind(null, storeId)}
          />
        </div>
      </header>

      <MetricsFilters
        defaultFrom={dateFrom.toISOString().slice(0, 10)}
        defaultTo={dateTo.toISOString().slice(0, 10)}
        defaultVendor={vendorFilter ?? []}
        showVendor={showVendor}
        availableVendors={vendors}
      />

      <MetricsKpis metrics={total} />

      {/* Individual orders — full per-order P&L. Click any row to override
          per-line COGs and the shipping cost. */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Orders ({orderList.length})
          </h2>
          <p className="text-xs text-muted-foreground">
            Click any row to override per-line costs or the shipping cost for that order.
          </p>
        </div>
        <OrdersTable
          orders={orderList}
          canEdit={hasPermission(role, 'manage_sku_costs')}
          costCurrency={store.costCurrency}
          getDetailAction={getOrderDetail}
          saveAction={updateOrderOverrides as unknown as (input: {
            orderId: string;
            lineCosts: Record<string, number | null>;
            shippingCostOverride: number | null;
            shippingCostOverrideNote: string | null;
          }) => Promise<{ linesUpdated: number; shippingUpdated: boolean }>}
        />
      </section>
    </div>
  );
}
