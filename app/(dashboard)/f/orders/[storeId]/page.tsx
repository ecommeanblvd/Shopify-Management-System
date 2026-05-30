import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { db, schema } from '@/db/client';
import { getStoreMetrics, type Grouping } from '@/features/shopify-orders/dashboard-actions';
import { MetricsKpis } from '@/components/shopify-orders/MetricsKpis';
import { MetricsTable } from '@/components/shopify-orders/MetricsTable';
import { MetricsFilters } from '@/components/shopify-orders/MetricsFilters';
import { HealthCard } from '@/components/shopify-orders/HealthCard';

export const dynamic = 'force-dynamic';

// Hard-coded per spec — only the MEAN store exposes a vendor filter in v1.
// Update this list (or move to a feature flag) when more stores need it.
const VENDOR_FILTER_DOMAINS = ['mean-store.myshopify.com'];

export default async function StoreOrders({
  params,
  searchParams,
}: {
  params: Promise<{ storeId: string }>;
  searchParams: Promise<{ from?: string; to?: string; vendor?: string; group?: Grouping }>;
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
  const grouping = (sp.group as Grouping) ?? 'day';
  const vendorFilter = sp.vendor?.split(',').filter(Boolean);

  const showVendor = VENDOR_FILTER_DOMAINS.includes(store.shopDomain);

  const { total, buckets } = await getStoreMetrics({
    storeId,
    dateFrom,
    dateTo,
    vendorFilter: showVendor ? vendorFilter : undefined,
    grouping,
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

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">{store.name}</h1>
        <p className="text-sm text-muted-foreground mt-1 font-mono">
          {store.shopDomain}
          {total.currency ? ` · ${total.currency}` : ''}
        </p>
      </header>

      <HealthCard storeId={storeId} />

      <MetricsFilters
        defaultFrom={dateFrom.toISOString().slice(0, 10)}
        defaultTo={dateTo.toISOString().slice(0, 10)}
        defaultGrouping={grouping}
        defaultVendor={vendorFilter ?? []}
        showVendor={showVendor}
        availableVendors={vendors}
      />

      <MetricsKpis metrics={total} />

      <MetricsTable buckets={buckets} grouping={grouping} currency={total.currency} />
    </div>
  );
}
