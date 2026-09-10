'use client';

import { useMemo, useState, useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { MetricsFilters } from './MetricsFilters';
import { MetricsKpis } from './MetricsKpis';
import { OrdersTable } from './OrdersTable';
import { aggregateMetrics } from '@/features/shopify-orders/metrics/aggregate';
import type { OrderRow } from '@/features/shopify-orders/dashboard-actions';
import type { OrderDetail } from '@/features/shopify-orders/order-actions';
import { NHAN_MOC, trongKhoang, type MocLoc } from '@/features/shopify-orders/loc-ngay';

interface OrdersBoardProps {
  storeId: string;
  /** Every order in the warmed server cache. Larger than the active
   *  filter window — typically the last 90 days. Feeds the KPI cards only
   *  (the date presets re-aggregate this array client-side, no roundtrip). */
  cachedOrders: OrderRow[];
  /** Inclusive bounds of `cachedOrders` (YYYY-MM-DD). Filter requests
   *  that extend past these bounds fall back to a server roundtrip. */
  cacheFromISO: string;
  cacheToISO: string;

  /** First page of the all-time orders table + its grand total. The table is
   *  independent of the KPI date window — it paginates the store's full
   *  history server-side via `fetchOrdersPageAction`. */
  initialOrderRows: OrderRow[];
  initialOrderTotalCount: number;
  fetchOrdersPageAction: (args: {
    storeId: string;
    page: number;
    pageSize: number;
    search: string;
    sort: 'newest' | 'oldest';
    dateFromISO?: string;
    dateToISO?: string;
    moc?: MocLoc;
  }) => Promise<{ rows: OrderRow[]; totalCount: number }>;

  /** Active filter from the URL on first render (YYYY-MM-DD). */
  initialFromISO: string;
  initialToISO: string;
  initialVendor: string[];
  /** Mốc lọc ngày (ngày đặt / ngày gửi) từ URL. */
  initialMoc: MocLoc;

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
    shippingCostOverride: number | null;
    shippingCostOverrideNote: string | null;
    shipWeightKgOverride: number | null;
  }) => Promise<{ shippingUpdated: boolean }>;
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
  storeId,
  cachedOrders,
  cacheFromISO,
  cacheToISO,
  initialOrderRows,
  initialOrderTotalCount,
  fetchOrdersPageAction,
  initialFromISO,
  initialToISO,
  initialVendor,
  initialMoc,
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
  const [moc, setMoc] = useState<MocLoc>(initialMoc);
  const [pending, startTransition] = useTransition();

  // Filter the cache to the active window (theo mốc ngày đặt / ngày gửi). Inclusive on both ends —
  // the server already does this for the initial render (cache nạp theo cùng mốc).
  const visibleOrders = useMemo(
    () => cachedOrders.filter((o) => trongKhoang(o, from, to, moc)),
    [cachedOrders, from, to, moc],
  );

  const aggregate = useMemo(() => aggregateMetrics(visibleOrders), [visibleOrders]);

  const onChange = (patch: { from?: string; to?: string; vendor?: string[]; moc?: MocLoc }): void => {
    const nextFrom = patch.from ?? from;
    const nextTo = patch.to ?? to;
    const nextVendor = patch.vendor ?? vendor;
    const nextMoc = patch.moc ?? moc;

    const dateInsideCache = nextFrom >= cacheFromISO && nextTo <= cacheToISO;
    const vendorChanged = !arraysEqual(nextVendor, vendor);
    // Đổi mốc → cache đang nạp theo mốc cũ không dùng lại được → đi server.
    const mocChanged = nextMoc !== moc;

    // Build the URL params once so both branches sync the URL identically.
    const params = new URLSearchParams();
    params.set('from', nextFrom);
    params.set('to', nextTo);
    if (nextVendor.length > 0) params.set('vendor', nextVendor.join(','));
    if (nextMoc !== 'order') params.set('moc', nextMoc);

    if (dateInsideCache && !vendorChanged && !mocChanged) {
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
      setMoc(nextMoc);
      startTransition(() => router.replace(`${pathname}?${params.toString()}`));
    }
  };

  return (
    <>
      <MetricsFilters
        from={from}
        to={to}
        vendor={vendor}
        moc={moc}
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
              ({NHAN_MOC[moc].toLowerCase()} {from} → {to})
            </span>
          </h2>
          <p className="text-xs text-muted-foreground">
            Bảng theo cùng bộ lọc ngày với KPI ({NHAN_MOC[moc].toLowerCase()}; theo ngày gửi thì đơn chưa gửi không hiện).
            Gõ mã đơn / tên người nhận để tìm trên TOÀN BỘ lịch sử (bỏ lọc ngày); bấm 1 dòng để xem P&L / sửa ship.
          </p>
        </div>
        <OrdersTable
          storeId={storeId}
          initialRows={initialOrderRows}
          initialTotalCount={initialOrderTotalCount}
          fetchPageAction={fetchOrdersPageAction}
          fromISO={from}
          toISO={to}
          moc={moc}
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
