'use server';

import { and, eq, gte, lte, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { computeOrderMetrics, type OrderMetrics } from './metrics/compute';
import { aggregateMetrics, type AggregateMetrics } from './metrics/aggregate';

export type Grouping = 'day' | 'week' | 'month' | 'vendor';

export interface GetStoreMetricsArgs {
  storeId: string;
  dateFrom: Date;
  dateTo: Date;
  vendorFilter?: string[];
  grouping: Grouping;
}

export interface MetricsBucket {
  bucketKey: string;
  bucketLabel: string;
  metrics: AggregateMetrics;
}

export interface GetStoreMetricsResult {
  total: AggregateMetrics;
  buckets: MetricsBucket[];
}

/**
 * Pull orders + lines + cost rows + shipping invoices, compute per-order
 * metrics in JS (so the formula stays in one place), and bucket by the
 * requested grouping.
 *
 * For v1 this materializes all rows in the date window into memory. If a
 * store ships > 100k orders / period and this gets slow, replace with a
 * SQL-side aggregation that uses date_trunc + SUM and a separate cost
 * coverage join — but defer until measured.
 */
export async function getStoreMetrics(args: GetStoreMetricsArgs): Promise<GetStoreMetricsResult> {
  const where = and(
    eq(schema.shopifyOrders.storeId, args.storeId),
    gte(schema.shopifyOrders.processedAtShopify, args.dateFrom),
    lte(schema.shopifyOrders.processedAtShopify, args.dateTo),
  );

  const orders = await db.select().from(schema.shopifyOrders).where(where);
  if (orders.length === 0) {
    return { total: emptyAgg(), buckets: [] };
  }
  const orderIds = orders.map((o) => o.id);

  const lines = await db
    .select()
    .from(schema.shopifyOrderLines)
    .where(inArray(schema.shopifyOrderLines.orderId, orderIds));
  const refunds = await db
    .select()
    .from(schema.shopifyOrderRefunds)
    .where(inArray(schema.shopifyOrderRefunds.orderId, orderIds));

  // Cost lookup per (sku, processedAt) — fetch all rows for SKUs we touch
  // and pick the latest effective per order in JS.
  const skus = Array.from(new Set(lines.map((l) => l.sku).filter((s): s is string => !!s)));
  const allCosts = skus.length === 0
    ? []
    : await db
        .select()
        .from(schema.skuCosts)
        .where(and(
          eq(schema.skuCosts.storeId, args.storeId),
          inArray(schema.skuCosts.sku, skus),
        ));
  const costIndex = indexCostsBySku(allCosts);

  // Shipping invoice lookup — by tracking number from raw payload.
  const trackingByOrder = new Map<string, string[]>();
  for (const o of orders) {
    const tracking = extractTrackingNumbers(o.rawPayload);
    if (tracking.length > 0) trackingByOrder.set(o.id, tracking);
  }
  const allTracking = Array.from(new Set([...trackingByOrder.values()].flat()));
  const invoices = allTracking.length === 0
    ? []
    : await db
        .select()
        .from(schema.shippingInvoices)
        .where(and(
          eq(schema.shippingInvoices.storeId, args.storeId),
          inArray(schema.shippingInvoices.trackingNumber, allTracking),
        ));
  const invoiceIndex = new Map(invoices.map((i) => [i.trackingNumber, i]));

  // Compute per-order metrics.
  const allMetrics: Array<OrderMetrics & { vendor: string[]; bucketKey: string; bucketLabel: string }> = [];
  for (const o of orders) {
    const oLines = lines.filter((l) => l.orderId === o.id);
    const filteredLines = args.vendorFilter && args.vendorFilter.length > 0
      ? oLines.filter((l) => l.vendor && args.vendorFilter!.includes(l.vendor))
      : oLines;
    if (args.vendorFilter && filteredLines.length === 0) continue;

    const grossLineTotal = sumNumeric(filteredLines.map((l) => Number(l.unitPrice) * l.quantity));
    const totalRefunded = refunds
      .filter((r) => r.orderId === o.id)
      .reduce((s, r) => s + Number(r.amount), 0);

    // Pro-rata split for order-level fields when vendor filter is active.
    const wholeOrderGross = sumNumeric(oLines.map((l) => Number(l.unitPrice) * l.quantity));
    const share = wholeOrderGross > 0 ? grossLineTotal / wholeOrderGross : 1;

    // Shipping cost — invoice if matching tracking, else surface as unknown.
    // Task 19a will wire in the live carrier-engine estimate for the
    // no-invoice branch.
    let shippingCost: { amount: number; source: 'invoice' | 'engine_estimate' | 'unknown' };
    const tracking = trackingByOrder.get(o.id) ?? [];
    const matchingInvoice = tracking.map((t) => invoiceIndex.get(t)).find((i) => !!i);
    if (matchingInvoice) {
      shippingCost = { amount: Number(matchingInvoice.actualCost) * share, source: 'invoice' };
    } else {
      shippingCost = { amount: 0, source: 'unknown' };
    }

    const skuCosts = filteredLines.map((l) => {
      const cost = l.sku
        ? (costIndex.get(l.sku) ?? []).find((c) => new Date(c.effectiveFrom) <= o.processedAtShopify)
        : null;
      return {
        lineId: l.id,
        quantity: l.quantity,
        costPerUnit: cost ? Number(cost.costPerUnit) : null,
        costCurrency: cost?.currency ?? null,
      };
    });

    const m = computeOrderMetrics({
      orderId: o.id,
      currency: o.currency,
      grossLineTotal,
      totalDiscount: Number(o.totalDiscount) * share,
      totalShipping: Number(o.totalShipping) * share,
      totalTax: Number(o.totalTax) * share,
      totalRefunded: totalRefunded * share,
      shippingCost,
      skuCosts,
    });

    const vendor = filteredLines.map((l) => l.vendor).filter((v): v is string => !!v);
    const { key, label } = bucketize(o.processedAtShopify, vendor, args.grouping);
    allMetrics.push({ ...m, vendor, bucketKey: key, bucketLabel: label });
  }

  const buckets = groupBucketMetrics(allMetrics);
  const total = aggregateMetrics(allMetrics);
  return { total, buckets };
}

function indexCostsBySku(
  rows: typeof schema.skuCosts.$inferSelect[],
): Map<string, typeof schema.skuCosts.$inferSelect[]> {
  const idx = new Map<string, typeof schema.skuCosts.$inferSelect[]>();
  for (const r of rows) {
    const arr = idx.get(r.sku) ?? [];
    arr.push(r);
    idx.set(r.sku, arr);
  }
  // Sort newest-first so .find() picks the most recently effective row.
  for (const arr of idx.values()) {
    arr.sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
  }
  return idx;
}

function extractTrackingNumbers(payload: unknown): string[] {
  const p = payload as { fulfillments?: Array<{ trackingInfo: Array<{ number: string | null }> }> };
  if (!p?.fulfillments) return [];
  return p.fulfillments
    .flatMap((f) => f.trackingInfo.map((t) => t.number))
    .filter((n): n is string => !!n);
}

function sumNumeric(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0);
}

function bucketize(date: Date, vendors: string[], grouping: Grouping): { key: string; label: string } {
  if (grouping === 'vendor') {
    const v = vendors[0] ?? '(no vendor)';
    return { key: v, label: v };
  }
  const iso = date.toISOString().slice(0, 10);
  if (grouping === 'day') return { key: iso, label: iso };
  if (grouping === 'week') {
    const monday = new Date(date);
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    const k = monday.toISOString().slice(0, 10);
    return { key: k, label: `Week of ${k}` };
  }
  // month
  const k = iso.slice(0, 7);
  return { key: k, label: k };
}

function groupBucketMetrics(
  items: Array<OrderMetrics & { bucketKey: string; bucketLabel: string }>,
): MetricsBucket[] {
  const grouped = new Map<string, { label: string; items: OrderMetrics[] }>();
  for (const m of items) {
    const g = grouped.get(m.bucketKey) ?? { label: m.bucketLabel, items: [] };
    g.items.push(m);
    grouped.set(m.bucketKey, g);
  }
  return [...grouped.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, g]) => ({ bucketKey: k, bucketLabel: g.label, metrics: aggregateMetrics(g.items) }));
}

function emptyAgg(): AggregateMetrics {
  return {
    orderCount: 0, currency: '',
    gmv: 0, refundedAmount: 0, netGmv: 0, discount: 0,
    shippingRevenue: 0, shippingCost: 0, skuCost: 0, tax: 0,
    revenue: 0, margin: 0, skuCostCoverage: 0,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Drill-down queries for the health card
// ─────────────────────────────────────────────────────────────────────

export interface MissingCostOrder {
  orderId: string;
  shopifyOrderNumber: string;
  processedAt: Date;
  missingSkus: string[];
}

/** Lists orders in the window that contain at least one line whose SKU
 *  has no effective cost row at or before processed_at_shopify. */
export async function getMissingCostOrders(
  storeId: string, dateFrom: Date, dateTo: Date,
): Promise<MissingCostOrder[]> {
  const rows = await db.execute<{
    order_id: string; shopify_order_number: string; processed_at_shopify: Date; missing_skus: string[];
  }>(sql`
    SELECT o.id AS order_id,
           o.shopify_order_number,
           o.processed_at_shopify,
           ARRAY_AGG(DISTINCT l.sku) FILTER (WHERE l.sku IS NOT NULL) AS missing_skus
      FROM shopify_orders o
      JOIN shopify_order_lines l ON l.order_id = o.id
     WHERE o.store_id = ${storeId}
       AND o.processed_at_shopify BETWEEN ${dateFrom} AND ${dateTo}
       AND l.sku IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM sku_costs c
          WHERE c.store_id = o.store_id
            AND c.sku = l.sku
            AND c.effective_from <= o.processed_at_shopify::date
       )
     GROUP BY o.id, o.shopify_order_number, o.processed_at_shopify
     ORDER BY o.processed_at_shopify DESC
     LIMIT 100;
  `);
  return (rows as unknown as Array<{
    order_id: string; shopify_order_number: string; processed_at_shopify: Date | string; missing_skus: string[] | null;
  }>).map((r) => ({
    orderId: r.order_id,
    shopifyOrderNumber: r.shopify_order_number,
    processedAt: r.processed_at_shopify instanceof Date ? r.processed_at_shopify : new Date(r.processed_at_shopify),
    missingSkus: r.missing_skus ?? [],
  }));
}

export interface MissingInvoiceShipment {
  orderId: string;
  shopifyOrderNumber: string;
  trackingNumber: string;
}

/** Lists shipments (one row per tracking number) that have no matching
 *  shipping_invoices row yet. */
export async function getMissingInvoiceShipments(
  storeId: string, dateFrom: Date, dateTo: Date,
): Promise<MissingInvoiceShipment[]> {
  const rows = await db.execute<{ order_id: string; shopify_order_number: string; tracking_number: string }>(sql`
    WITH tracked AS (
      SELECT o.id AS order_id,
             o.shopify_order_number,
             jsonb_array_elements(f -> 'trackingInfo') ->> 'number' AS tracking_number
        FROM shopify_orders o,
             jsonb_array_elements(o.raw_payload -> 'fulfillments') AS f
       WHERE o.store_id = ${storeId}
         AND o.processed_at_shopify BETWEEN ${dateFrom} AND ${dateTo}
    )
    SELECT t.order_id, t.shopify_order_number, t.tracking_number
      FROM tracked t
     WHERE t.tracking_number IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM shipping_invoices si
          WHERE si.store_id = ${storeId}
            AND si.tracking_number = t.tracking_number
       )
     ORDER BY t.shopify_order_number
     LIMIT 100;
  `);
  return rows as unknown as MissingInvoiceShipment[];
}
