'use server';

import { and, eq, gte, lte, inArray, or, ilike, asc, desc, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { computeOrderMetrics, type OrderMetrics } from './metrics/compute';
import { aggregateMetrics, type AggregateMetrics } from './metrics/aggregate';
import { createBatchShippingEstimator } from './sync/batch-shipping-estimator';

export interface GetStoreMetricsArgs {
  storeId: string;
  dateFrom: Date;
  dateTo: Date;
  vendorFilter?: string[];
}

/** One row per Shopify order, ready for the dashboard's orders table. */
export interface OrderRow extends OrderMetrics {
  shopifyOrderNumber: string;
  processedAt: Date;
  lineCount: number;
  hasOverrides: boolean;
  /** Trạng thái Shopify (thô) để hiển thị badge trạng thái đơn. */
  financialStatus: string;
  fulfillmentStatus: string | null;
  cancelledAt: Date | null;
  /** Margin ship = ship rev − ship cost, ở đồng cost (VND). null khi cost unknown.
   *  Âm = charge thiếu (lỗ ship). Nguồn cost xem `shippingCostSource`. */
  shipMarginRaw: number | null;
  shipMarginRawCurrency: string;
}

export interface GetStoreMetricsResult {
  total: AggregateMetrics;
  orders: OrderRow[];
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
  const orders = await db
    .select()
    .from(schema.shopifyOrders)
    .where(and(
      eq(schema.shopifyOrders.storeId, args.storeId),
      gte(schema.shopifyOrders.processedAtShopify, args.dateFrom),
      lte(schema.shopifyOrders.processedAtShopify, args.dateTo),
    ));
  if (orders.length === 0) return { total: emptyAgg(), orders: [] };
  const { rows, total } = await buildOrderRows(args.storeId, orders, args.vendorFilter);
  rows.sort((a, b) => b.processedAt.getTime() - a.processedAt.getTime());
  return { total, orders: rows };
}

/**
 * Compute per-order metric rows for an already-fetched set of orders. Shared by
 * the windowed KPI path (`getStoreMetrics`) and the all-time paginated table
 * (`getStoreOrdersPage`) so the cost / margin / ship formulas live in exactly
 * one place. Preserves the input order — the caller decides sorting.
 */
async function buildOrderRows(
  storeId: string,
  orders: (typeof schema.shopifyOrders.$inferSelect)[],
  vendorFilter?: string[],
): Promise<{ rows: OrderRow[]; total: AggregateMetrics }> {
  if (orders.length === 0) return { rows: [], total: emptyAgg() };
  const orderIds = orders.map((o) => o.id);

  // Per-store cost FX — used to convert COGs that were entered in a brand
  // currency (e.g. Mirer's VND) into the order currency (USD) before the
  // revenue formula subtracts them.
  const [store] = await db
    .select({
      costCurrency: schema.stores.costCurrency,
      fxCostPerOrderCurrency: schema.stores.fxCostPerOrderCurrency,
    })
    .from(schema.stores)
    .where(eq(schema.stores.id, storeId));
  const storeFx = {
    costCurrency: store?.costCurrency ?? null,
    fxRate: store?.fxCostPerOrderCurrency !== null && store?.fxCostPerOrderCurrency !== undefined
      ? Number(store.fxCostPerOrderCurrency)
      : null,
  };
  // NOTE: `stores.packaging_fee` is intentionally NOT read here. Packaging
  // is an operations-side input consumed by the Shopify-pricing engine to
  // build the customer-facing shipping rate. It is NOT a carrier cost, so
  // including it in the dashboard's Ship cost column would muddle
  // reconciliation against the carrier invoice.
  const convertCost = (amount: number, fromCurrency: string | null, orderCurrency: string): number => {
    if (!fromCurrency || fromCurrency === orderCurrency) return amount;
    if (!storeFx.costCurrency || !storeFx.fxRate || storeFx.fxRate === 0) return amount;
    // We only know how to convert the store's configured cost currency.
    // Anything else falls back uncorrected — the caller will see margins
    // skew but won't blow up.
    if (fromCurrency !== storeFx.costCurrency) return amount;
    return amount / storeFx.fxRate;
  };

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
          eq(schema.skuCosts.storeId, storeId),
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
          eq(schema.shippingInvoices.storeId, storeId),
          inArray(schema.shippingInvoices.trackingNumber, allTracking),
        ));
  const invoiceIndex = new Map(invoices.map((i) => [i.trackingNumber, i]));

  // Billed THẬT từ đối soát carrier (shipment_charges, đồng cost = VND) — cộng
  // dồn theo đơn (đơn nhiều pack). Ưu tiên hơn shipping_invoices & engine.
  const billedRows = await db
    .select({ orderId: schema.shipments.orderId, total: schema.shipmentCharges.totalAmount })
    .from(schema.shipmentCharges)
    .innerJoin(schema.shipments, eq(schema.shipments.id, schema.shipmentCharges.shipmentId))
    .where(inArray(schema.shipments.orderId, orders.map((o) => o.id)));
  const billedByOrder = new Map<string, number>();
  for (const r of billedRows) billedByOrder.set(r.orderId, (billedByOrder.get(r.orderId) ?? 0) + Number(r.total));

  // Pre-warm a shipping estimator. The old per-order
  // `resolveShippingEstimate(...)` call ran ~2 SQL queries plus a full
  // carrier snapshot load (5 more queries) for each order without an
  // invoice — turning a single dashboard render into thousands of round
  // trips on stores with many orders. The batched version loads markets,
  // links, and snapshots once, then `estimate()` is pure compute with a
  // per-(country, weight) memo for repeat shipments.
  const estimator = await createBatchShippingEstimator();

  // Compute per-order metrics.
  const allMetrics: OrderMetrics[] = [];
  const rows: OrderRow[] = [];
  for (const o of orders) {
    const oLines = lines.filter((l) => l.orderId === o.id);
    const filteredLines = vendorFilter && vendorFilter.length > 0
      ? oLines.filter((l) => l.vendor && vendorFilter.includes(l.vendor))
      : oLines;
    if (vendorFilter && filteredLines.length === 0) continue;

    const grossLineTotal = sumNumeric(filteredLines.map((l) => Number(l.unitPrice) * l.quantity));
    const totalRefunded = refunds
      .filter((r) => r.orderId === o.id)
      .reduce((s, r) => s + Number(r.amount), 0);

    // Pro-rata split for order-level fields when vendor filter is active.
    const wholeOrderGross = sumNumeric(oLines.map((l) => Number(l.unitPrice) * l.quantity));
    const share = wholeOrderGross > 0 ? grossLineTotal / wholeOrderGross : 1;

    // Shipping cost — precedence:
    //   1. Per-order manual override (operator-set on the order edit modal)
    //   2. Matching shipping_invoices row
    //   3. Live carrier-engine estimate
    //   4. unknown
    //
    // Overrides and invoices are entered in the store's cost currency
    // (Vietnamese brands pay carriers in VND even though the customer
    // settled in USD). The same convertCost() helper folds them back to
    // the order currency before the revenue formula sees them. Engine
    // quotes already come back in the carrier-account's display currency,
    // which we treat as the order currency.
    // We carry BOTH numbers through:
    //   - `amount` in the order currency (USD) — what Revenue subtracts
    //   - `rawAmount` in the source-of-truth cost currency (VND, taken
    //     straight from the engine / invoice / override input)
    //
    // Computing rawAmount FROM the source value instead of inverse-FX'ing
    // the USD value preserves precision (a VND→USD→VND round-trip loses
    // up to ~half a VND per cent of rounding). The orders dashboard shows
    // rawAmount when the store has a cost currency configured.
    let shippingCost: {
      amount: number;
      rawAmount: number;
      rawCurrency: string;
      source: 'override' | 'invoice' | 'engine_estimate' | 'unknown';
      reason?:
        | 'no_country'
        | 'no_weight'
        | 'no_market'
        | 'no_carrier_link'
        | 'no_carrier_accounts'
        | 'no_quote';
    };
    // Currency the raw value lives in: store cost currency (Mirer's VND)
    // when configured, else the order's own currency. The raw amount is
    // ALWAYS expressed in this currency regardless of source.
    const rawCurrency = storeFx.costCurrency ?? o.currency;
    if (o.shippingCostOverride !== null) {
      // Override is entered IN the cost currency by convention. Raw is
      // the entered value verbatim; amount is converted to order currency.
      const raw = Number(o.shippingCostOverride);
      const converted = convertCost(raw, storeFx.costCurrency ?? o.currency, o.currency);
      shippingCost = {
        amount: converted * share,
        rawAmount: raw * share,
        rawCurrency,
        source: 'override',
      };
    } else if (billedByOrder.has(o.id)) {
      // Billed THẬT từ đối soát carrier (shipment_charges, đồng cost = VND).
      // Ưu tiên hơn shipping_invoices/engine — đây là số carrier charge thực.
      const raw = billedByOrder.get(o.id)!;
      const converted = convertCost(raw, storeFx.costCurrency ?? o.currency, o.currency);
      shippingCost = {
        amount: converted * share,
        rawAmount: raw * share,
        rawCurrency,
        source: 'invoice',
      };
    } else {
      const tracking = trackingByOrder.get(o.id) ?? [];
      const matchingInvoice = tracking.map((t) => invoiceIndex.get(t)).find((i) => !!i);
      if (matchingInvoice) {
        const raw = Number(matchingInvoice.actualCost);
        const converted = convertCost(raw, matchingInvoice.currency, o.currency);
        // When the invoice already came in the brand's cost currency, the
        // raw value is exact. Otherwise we fall back to the USD value × FX
        // so the column still shows something coherent; this only happens
        // for cross-currency invoices, which are an edge case.
        const rawAmount = matchingInvoice.currency === rawCurrency
          ? raw
          : storeFx.fxRate
            ? converted * storeFx.fxRate
            : converted;
        shippingCost = {
          amount: converted * share,
          rawAmount: rawAmount * share,
          rawCurrency,
          source: 'invoice',
        };
      } else {
        // Use the per-order weight override when set — operator points the
        // engine at the right weight after Shopify variant has been fixed
        // but the snapshot still carries the old value.
        const effectiveWeight = o.shipWeightKgOverride !== null
          ? Number(o.shipWeightKgOverride)
          : o.shipWeightKg !== null ? Number(o.shipWeightKg) : null;
        const est = estimator.estimate({
          shipCountry: o.shipCountry,
          shipCity: o.shipCity,
          shipPostcode: o.shipPostcode,
          shipWeightKg: effectiveWeight,
          // Anchor each order to its own ship-week so fuel%
          // (time-versioned per carrier_surcharges.startsAt/endsAt)
          // resolves to the rate sheet from when the carrier actually
          // billed us. Without this, an April order is mis-priced
          // against today's June fuel rate.
          effectiveDate: o.processedAtShopify ?? undefined,
          // Pin the quote to the carrier the customer actually paid
          // Shopify shipping for. NULL → estimator defaults to FedEx
          // per operator spec ("Không tự pick carrier"); never auto-
          // pick cheapest across brands.
          shippingCarrierKey: o.shippingCarrierKey ?? null,
        });
        // Engine returns BOTH the display-currency value (USD) and the
        // cost-currency value (VND, straight from the rate sheet). When
        // the carrier's cost currency matches the store's, the VND is
        // exact. Otherwise (rare) fall back via FX so the column doesn't
        // go blank.
        const rawAmount = est.costCurrency && est.costCurrency === rawCurrency
          ? est.costAmount
          : storeFx.fxRate
            ? est.amount * storeFx.fxRate
            : est.amount;
        shippingCost = {
          amount: est.amount * share,
          rawAmount: rawAmount * share,
          rawCurrency,
          source: est.source,
          reason: est.reason,
        };
      }
    }
    // NOTE: per-store `packaging_fee` is INTENTIONALLY NOT added to ship
    // cost. Packaging (boxes / labels / dunnage) is an operations-side
    // input we use later when computing the customer-facing shipping
    // price on Shopify — it's NOT part of what we pay the carrier, so
    // showing it under "Ship cost" would muddle carrier-invoice
    // reconciliation. The store-level packaging_fee is left in the
    // schema for the future Shopify-pricing engine to consume.

    // Per-line SKU cost — line-level override wins over the sku_costs lookup.
    // Costs that arrive in a different currency than the order are converted
    // to the order currency via the per-store FX rate before the revenue
    // formula sees them, so revenue/margin stay in a single currency.
    const skuCosts = filteredLines.map((l) => {
      if (l.costOverride !== null) {
        // Manual override on the line — interpreted as the store's
        // configured cost currency (Mirer's VND), or the order's own
        // currency when the store has no FX set up.
        const rawCurrency = storeFx.costCurrency ?? o.currency;
        const converted = convertCost(Number(l.costOverride), rawCurrency, o.currency);
        return {
          lineId: l.id,
          quantity: l.quantity,
          costPerUnit: converted,
          costCurrency: o.currency,
        };
      }
      const cost = l.sku
        ? (costIndex.get(l.sku) ?? []).find((c) => new Date(c.effectiveFrom) <= o.processedAtShopify)
        : null;
      if (!cost) {
        return {
          lineId: l.id,
          quantity: l.quantity,
          costPerUnit: null,
          costCurrency: null,
        };
      }
      const converted = convertCost(Number(cost.costPerUnit), cost.currency, o.currency);
      return {
        lineId: l.id,
        quantity: l.quantity,
        costPerUnit: converted,
        costCurrency: o.currency,
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

    const hasLineOverride = filteredLines.some((l) => l.costOverride !== null);
    const hasOverrides = hasLineOverride
      || o.shippingCostOverride !== null
      || o.shipWeightKgOverride !== null;
    // Margin ship (đồng raw = cost currency, VND): ship rev (quy về raw ccy)
    // − ship cost raw. null khi chưa biết cost (unknown) hoặc không quy được.
    const shipRevRaw = rawCurrency === o.currency
      ? Number(o.totalShipping) * share
      : (storeFx.fxRate ? Number(o.totalShipping) * share * storeFx.fxRate : null);
    const shipMarginRaw = (shippingCost.source !== 'unknown' && shipRevRaw !== null)
      ? shipRevRaw - shippingCost.rawAmount
      : null;
    allMetrics.push(m);
    rows.push({
      ...m,
      shopifyOrderNumber: o.shopifyOrderNumber,
      processedAt: o.processedAtShopify,
      lineCount: filteredLines.length,
      hasOverrides,
      financialStatus: o.financialStatus,
      fulfillmentStatus: o.fulfillmentStatus,
      cancelledAt: o.cancelledAtShopify,
      shipMarginRaw,
      shipMarginRawCurrency: rawCurrency,
    });
  }

  const total = aggregateMetrics(allMetrics);
  return { rows, total };
}

// ─────────────────────────────────────────────────────────────────────
// All-time, server-side paginated order list (the orders table).
// Decoupled from getStoreMetrics' date window: the KPI cards stay a
// windowed analytics tool, while this walks the store's ENTIRE history one
// page at a time so payload/compute stay bounded regardless of store size.
// ─────────────────────────────────────────────────────────────────────

export interface GetStoreOrdersPageArgs {
  storeId: string;
  /** 0-based page index. */
  page: number;
  /** Rows per page (25 | 50 | 100 | 250 from the UI). */
  pageSize: number;
  /** Matches order number OR recipient name (ILIKE), leading '#' stripped. */
  search?: string;
  sort?: 'newest' | 'oldest';
}

export interface GetStoreOrdersPageResult {
  rows: OrderRow[];
  /** Total orders matching the filter across ALL pages — drives page count. */
  totalCount: number;
}

export async function getStoreOrdersPage(
  args: GetStoreOrdersPageArgs,
): Promise<GetStoreOrdersPageResult> {
  const { storeId, sort = 'newest' } = args;
  const q = (args.search ?? '').trim().replace(/^#/, '');
  const searchCond = q
    ? or(
        ilike(schema.shopifyOrders.shopifyOrderNumber, `%${q}%`),
        ilike(schema.shopifyOrders.shipName, `%${q}%`),
      )
    : undefined;
  const where = and(eq(schema.shopifyOrders.storeId, storeId), searchCond);

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.shopifyOrders)
    .where(where);
  const totalCount = countRow?.count ?? 0;
  if (totalCount === 0) return { rows: [], totalCount: 0 };

  // Clamp inputs so a stale/absurd page or size can't produce a negative
  // OFFSET or an unbounded LIMIT.
  const pageSize = Math.min(500, Math.max(1, Math.floor(args.pageSize)));
  const lastPage = Math.max(0, Math.ceil(totalCount / pageSize) - 1);
  const page = Math.min(lastPage, Math.max(0, Math.floor(args.page)));

  const pageOrders = await db
    .select()
    .from(schema.shopifyOrders)
    .where(where)
    .orderBy(
      sort === 'oldest'
        ? asc(schema.shopifyOrders.processedAtShopify)
        : desc(schema.shopifyOrders.processedAtShopify),
    )
    .limit(pageSize)
    .offset(page * pageSize);

  // buildOrderRows preserves input order, so the SQL sort above is the
  // display order — no re-sort that would desync from the OFFSET window.
  const { rows } = await buildOrderRows(storeId, pageOrders);
  return { rows, totalCount };
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

function emptyAgg(): AggregateMetrics {
  return {
    orderCount: 0, currency: '',
    subtotal: 0, gmv: 0, refundedAmount: 0, netGmv: 0, discount: 0,
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
  // db.execute returns pg.QueryResult; rows are under `.rows`.
  return rows.rows.map((r) => ({
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
  return rows.rows.map((r) => ({
    orderId: r.order_id,
    shopifyOrderNumber: r.shopify_order_number,
    trackingNumber: r.tracking_number,
  }));
}
