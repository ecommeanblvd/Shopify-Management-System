'use client';

import { useMemo, useState, useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { MetricsFilters } from './MetricsFilters';
import { MetricsKpis } from './MetricsKpis';
import { OrdersTable } from './OrdersTable';
import { aggregateMetrics } from '@/features/shopify-orders/metrics/aggregate';
import type { OrderRow } from '@/features/shopify-orders/dashboard-actions';
import type { OrderDetail } from '@/features/shopify-orders/order-actions';

interface OrdersBoardProps {
  /** Every order in the warmed server cache. Larger than the active
   *  filter window — typically the last 90 days. Preset toggles that
   *  fall inside this cache filter the array client-side, no roundtrip. */
  cachedOrders: OrderRow[];
  /** Inclusive bounds of `cachedOrders` (YYYY-MM-DD). Filter requests
   *  that extend past these bounds fall back to a server roundtrip. */
  cacheFromISO: string;
  cacheToISO: string;

  /** Active filter from the URL on first render (YYYY-MM-DD). */
  initialFromISO: string;
  initialToISO: string;
  initialVendor: string[];

  showVendor: boolean;
  availableVendors: string[];

  canEdit: boolean;
  costCurrency: string | null;
  /** Forwarded straight through to <OrdersTable> so the Ship cost column
   *  can render in the brand's cost currency for FedEx reconciliation. */
  fxRate: number | null;
  getDetailAction: (orderId: string) => Promise<OrderDetail | null>;
  saveAction: (input: {
    orderId: string;
    lineCosts: Record<string, number | null>;
    shippingCostOverride: number | null;
    shippingCostOverrideNote: string | null;
    shipWeightKgOverride: number | null;
  }) => Promise<{ linesUpdated: number; shippingUpdated: boolean }>;
}

/**
 * Stitches the filters, the KPI tiles, and the orders table together so
 * preset date toggles (7d / 30d / 90d / YTD) feel instant: the server
 * pre-loads a 90-day cache, this wrapper re-filters the cache + re-runs
 * `aggregateMetrics` in JS, no roundtrip.
 *
 * The slow paths — custom ranges that extend past the cache, vendor
 * changes (vendor filtering affects pro-rata shares at compute time, not
 * just visible rows) — still trigger a server refetch via `router.replace`.
 */
export function OrdersBoard({
  cachedOrders,
  cacheFromISO,
  cacheToISO,
  initialFromISO,
  initialToISO,
  initialVendor,
  showVendor,
  availableVendors,
  canEdit,
  costCurrency,
  fxRate,
  getDetailAction,
  saveAction,
}: OrdersBoardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [from, setFrom] = useState(initialFromISO);
  const [to, setTo] = useState(initialToISO);
  const [vendor, setVendor] = useState(initialVendor);
  const [pending, startTransition] = useTransition();

  // Filter the cache to the active window. Inclusive on both ends —
  // the server already does this for the initial render.
  const visibleOrders = useMemo(() => {
    const fromMs = new Date(`${from}T00:00:00`).getTime();
    const toMs = new Date(`${to}T23:59:59.999`).getTime();
    return cachedOrders.filter((o) => {
      const t = new Date(o.processedAt).getTime();
      return t >= fromMs && t <= toMs;
    });
  }, [cachedOrders, from, to]);

  const aggregate = useMemo(() => aggregateMetrics(visibleOrders), [visibleOrders]);

  const onChange = (patch: { from?: string; to?: string; vendor?: string[] }): void => {
    const nextFrom = patch.from ?? from;
    const nextTo = patch.to ?? to;
    const nextVendor = patch.vendor ?? vendor;

    const dateInsideCache = nextFrom >= cacheFromISO && nextTo <= cacheToISO;
    const vendorChanged = !arraysEqual(nextVendor, vendor);

    // Build the URL params once so both branches sync the URL identically.
    const params = new URLSearchParams();
    params.set('from', nextFrom);
    params.set('to', nextTo);
    if (nextVendor.length > 0) params.set('vendor', nextVendor.join(','));

    if (dateInsideCache && !vendorChanged) {
      // Instant: pure client-side filter. Sync the URL without a
      // re-render so a bookmarked / shared link still reflects the
      // active window. window.history.replaceState() is the escape
      // hatch around Next.js's router-triggered refetch.
      setFrom(nextFrom);
      setTo(nextTo);
      window.history.replaceState(null, '', `${pathname}?${params.toString()}`);
    } else {
      // Slow path: range extends past the cache, OR vendor toggled.
      // Optimistically reflect the new selection in the toolbar so the
      // user gets immediate feedback, but the real data comes back from
      // the server.
      setFrom(nextFrom);
      setTo(nextTo);
      setVendor(nextVendor);
      startTransition(() => router.replace(`${pathname}?${params.toString()}`));
    }
  };

  return (
    <>
      <MetricsFilters
        from={from}
        to={to}
        vendor={vendor}
        showVendor={showVendor}
        availableVendors={availableVendors}
        cacheFromISO={cacheFromISO}
        cacheToISO={cacheToISO}
        pending={pending}
        onChange={onChange}
      />
      <MetricsKpis metrics={aggregate} />
      <section className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Orders{' '}
            <span className="text-muted-foreground/60 font-mono tabular-nums normal-case tracking-normal">
              ({cachedOrders.length.toLocaleString()}
              {visibleOrders.length !== cachedOrders.length && (
                <> &middot; <span className="text-foreground/70">{visibleOrders.length.toLocaleString()} in window</span></>
              )})
            </span>
          </h2>
          <p className="text-xs text-muted-foreground">
            Search by order #, or click any row to override per-line costs / shipping.
            Date filter narrows the KPIs above only — table keeps the full cache.
          </p>
        </div>
        <OrdersTable
          orders={cachedOrders}
          canEdit={canEdit}
          costCurrency={costCurrency}
          fxRate={fxRate}
          getDetailAction={getDetailAction}
          saveAction={saveAction}
        />
      </section>
    </>
  );
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const bSet = new Set(b);
  return a.every((x) => bSet.has(x));
}
