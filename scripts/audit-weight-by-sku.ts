/* eslint-disable no-console */
/**
 * Group the meanblvd audit findings by SKU so the operator can see
 * which products are driving the over/under-quote noise on the
 * dashboard. Reuses the same engine quote + reverse-tier logic as
 * `audit-meanblvd-charges.ts`.
 *
 * For every shipment that the audit classified as WEIGHT_UNDER or
 * WEIGHT_OVER, we pull the order's line items, attribute the order's
 * delta to each line by quantity share, and roll the result up to a
 * per-SKU table.
 *
 * Output: CSV to stdout, top-N by |VND impact| desc. Pipe to a file
 * and import into Google Sheets — column order matches what the
 * operator needs to update the Shopify variant grams field.
 *
 * Usage:
 *   pnpm tsx scripts/audit-weight-by-sku.ts > /tmp/sku-weight.csv
 *   pnpm tsx scripts/audit-weight-by-sku.ts --top 100 > out.csv
 */
import 'dotenv/config';
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { quote, type CarrierAccountSnapshot } from '@/features/carrier-rates/engine/quote';
import { loadAccountSnapshot } from '@/features/carrier-rates/engine/load';

interface Args {
  store: string;
  top: number;
  matchedTol: number;
  reverseTolPct: number;
}

function parseArgs(): Args {
  const a = process.argv.slice(2);
  const out: Args = {
    store: 'meanblvd.myshopify.com',
    top: 80,
    matchedTol: 50_000,
    reverseTolPct: 10,
  };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--store') out.store = a[++i];
    else if (a[i] === '--top') out.top = Number(a[++i]);
  }
  return out;
}

function impliedTier(
  snap: CarrierAccountSnapshot,
  country: string,
  carrierNetBase: number,
  discountPercent: number,
  tolPct: number,
): number | null {
  const zone = snap.zonesByCountry.get(country);
  if (!zone) return null;
  const dFrac = Math.max(0, Math.min(99, discountPercent)) / 100;
  let bestUpper: number | null = null;
  for (const [upperKg, listRate] of zone.rateByTierUpper) {
    const netRate = listRate * (1 - dFrac);
    const gapPct = Math.abs(netRate - carrierNetBase) / Math.max(netRate, 1) * 100;
    if (gapPct > tolPct) continue;
    if (bestUpper === null || upperKg < bestUpper) bestUpper = upperKg;
  }
  return bestUpper;
}

interface BadOrder {
  orderId: string;
  orderNumber: string;
  carrier: string;
  country: string;
  reportedKg: number;
  impliedKg: number;
  deltaKg: number;      // reported - implied (positive = we over-reported)
  deltaVnd: number;     // billedTotal - engineTotal
}

interface SkuRollup {
  sku: string;
  vendor: string | null;
  productTitle: string;
  variantTitle: string | null;
  orderCount: number;
  totalQty: number;
  /** Sum of (order.deltaKg × line.qty / order.total_qty). +ve = over-reported on average. */
  weightedDeltaKg: number;
  /** Same attribution for VND. */
  weightedDeltaVnd: number;
  /** Min/max impliedKg across the orders this SKU showed up in. */
  impliedKgs: number[];
  reportedKgs: number[];
}

async function main(): Promise<void> {
  const args = parseArgs();

  // 1. Pull every (shipment, charge, order, store) joined.
  const rows = await db
    .select({
      orderId: schema.shopifyOrders.id,
      orderNumber: schema.shopifyOrders.shopifyOrderNumber,
      carrierKey: schema.shipments.carrierKey,
      actualWeight: schema.shipments.actualWeightKg,
      dimL: schema.shipments.dimLengthCm,
      dimW: schema.shipments.dimWidthCm,
      dimH: schema.shipments.dimHeightCm,
      packaging: schema.shipments.packagingType,
      labelAt: schema.shipments.labelCreatedAt,
      billedTotal: schema.shipmentCharges.totalAmount,
      billedBase: schema.shipmentCharges.base,
      billedDiscount: schema.shipmentCharges.discount,
      country: schema.shopifyOrders.shipCountry,
      reportedWeight: schema.shopifyOrders.shipWeightKg,
      reportedWeightOverride: schema.shopifyOrders.shipWeightKgOverride,
      postcode: schema.shopifyOrders.shipPostcode,
      city: schema.shopifyOrders.shipCity,
      processedAt: schema.shopifyOrders.processedAtShopify,
    })
    .from(schema.shipmentCharges)
    .innerJoin(schema.shipments, eq(schema.shipments.id, schema.shipmentCharges.shipmentId))
    .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.shipments.orderId))
    .innerJoin(schema.stores, eq(schema.stores.id, schema.shopifyOrders.storeId))
    .where(and(eq(schema.stores.shopDomain, args.store)));

  // 2. Pre-load carrier snapshots once.
  const carriers = await db
    .select({ id: schema.carrierAccounts.id, key: schema.carriers.key })
    .from(schema.carrierAccounts)
    .leftJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId))
    .where(eq(schema.carrierAccounts.enabled, true));
  const snapsByKey = new Map<string, CarrierAccountSnapshot>();
  for (const c of carriers) {
    if (c.key === 'fedex' || c.key === 'dhl') {
      const s = await loadAccountSnapshot(c.id);
      if (s && !snapsByKey.has(c.key)) snapsByKey.set(c.key, s);
    }
  }

  // 3. Find orders with a weight discrepancy big enough to matter.
  const badOrders: BadOrder[] = [];
  for (const r of rows) {
    const reported = r.reportedWeightOverride !== null
      ? Number(r.reportedWeightOverride)
      : r.reportedWeight !== null ? Number(r.reportedWeight) : null;
    const snap = r.carrierKey ? snapsByKey.get(r.carrierKey) : undefined;
    if (!snap || !reported || reported <= 0 || !r.country) continue;

    const billedBase = r.billedBase !== null ? Number(r.billedBase) : 0;
    const billedDisc = r.billedDiscount !== null ? Number(r.billedDiscount) : 0;
    const carrierNetBase = billedBase + billedDisc;
    if (carrierNetBase <= 0) continue;

    // Quote once to get discount %.
    const dims = (r.dimL && r.dimW && r.dimH)
      ? { lengthCm: Number(r.dimL), widthCm: Number(r.dimW), heightCm: Number(r.dimH) }
      : null;
    const q = quote(snap, {
      weightKg: reported,
      dimensions: dims,
      packagingType: r.packaging,
      destinationCountry: r.country,
      destinationPostcode: r.postcode ?? undefined,
      destinationCity: r.city ?? undefined,
      effectiveDate: r.labelAt ?? r.processedAt ?? undefined,
    });
    if (!q.ok) continue;

    const implied = impliedTier(snap, r.country, carrierNetBase, q.breakdown.discountPercent, args.reverseTolPct);
    if (implied === null) continue;
    const deltaKg = reported - implied;
    if (Math.abs(deltaKg) / Math.max(reported, implied) < 0.10) continue; // <10% → not interesting

    const billedTotal = Number(r.billedTotal);
    const deltaVnd = billedTotal - q.breakdown.carrierCost;
    if (Math.abs(deltaVnd) < args.matchedTol) continue;

    badOrders.push({
      orderId: r.orderId,
      orderNumber: r.orderNumber,
      carrier: r.carrierKey ?? '?',
      country: r.country,
      reportedKg: reported,
      impliedKg: implied,
      deltaKg,
      deltaVnd,
    });
  }

  console.error(`[audit-sku] ${badOrders.length} orders flagged with material weight delta`);

  if (badOrders.length === 0) {
    console.log('No flagged orders.');
    return;
  }

  // 4. Load lines for all flagged orders in one query.
  const orderIds = [...new Set(badOrders.map((o) => o.orderId))];
  const lines = await db
    .select({
      orderId: schema.shopifyOrderLines.orderId,
      sku: schema.shopifyOrderLines.sku,
      vendor: schema.shopifyOrderLines.vendor,
      productTitle: schema.shopifyOrderLines.productTitle,
      variantTitle: schema.shopifyOrderLines.variantTitle,
      quantity: schema.shopifyOrderLines.quantity,
    })
    .from(schema.shopifyOrderLines)
    .where(inArray(schema.shopifyOrderLines.orderId, orderIds));

  const linesByOrder = new Map<string, typeof lines>();
  for (const l of lines) {
    const arr = linesByOrder.get(l.orderId) ?? [];
    arr.push(l);
    linesByOrder.set(l.orderId, arr);
  }

  // 5. Roll up by SKU.
  const skuMap = new Map<string, SkuRollup>();
  for (const o of badOrders) {
    const orderLines = (linesByOrder.get(o.orderId) ?? []).filter((l) => l.sku);
    const orderQty = orderLines.reduce((s, l) => s + l.quantity, 0);
    if (orderQty === 0) continue;

    for (const l of orderLines) {
      const sku = l.sku!;
      const qtyShare = l.quantity / orderQty;
      const e = skuMap.get(sku) ?? {
        sku,
        vendor: l.vendor,
        productTitle: l.productTitle,
        variantTitle: l.variantTitle,
        orderCount: 0,
        totalQty: 0,
        weightedDeltaKg: 0,
        weightedDeltaVnd: 0,
        impliedKgs: [],
        reportedKgs: [],
      };
      e.orderCount++;
      e.totalQty += l.quantity;
      e.weightedDeltaKg += o.deltaKg * qtyShare;
      e.weightedDeltaVnd += o.deltaVnd * qtyShare;
      e.impliedKgs.push(o.impliedKg);
      e.reportedKgs.push(o.reportedKg);
      skuMap.set(sku, e);
    }
  }

  // 6. Sort by |weightedDeltaVnd| desc; emit CSV.
  const ranked = [...skuMap.values()]
    .sort((a, b) => Math.abs(b.weightedDeltaVnd) - Math.abs(a.weightedDeltaVnd))
    .slice(0, args.top);

  const headers = [
    'rank', 'sku', 'vendor', 'product_title', 'variant_title',
    'order_count', 'total_qty',
    'avg_reported_kg', 'avg_implied_kg', 'avg_delta_kg',
    'weighted_delta_kg', 'weighted_delta_vnd',
    'direction',
  ];
  console.log(headers.join(','));
  function csv(s: string | number | null): string {
    if (s === null) return '';
    const str = String(s);
    return /[",\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
  }
  ranked.forEach((e, i) => {
    const avgReported = e.reportedKgs.reduce((a, b) => a + b, 0) / e.reportedKgs.length;
    const avgImplied = e.impliedKgs.reduce((a, b) => a + b, 0) / e.impliedKgs.length;
    const direction = e.weightedDeltaKg > 0 ? 'OVER (reported > actual)' : 'UNDER (reported < actual)';
    console.log([
      i + 1,
      csv(e.sku),
      csv(e.vendor),
      csv(e.productTitle),
      csv(e.variantTitle),
      e.orderCount,
      e.totalQty,
      avgReported.toFixed(3),
      avgImplied.toFixed(3),
      (avgReported - avgImplied).toFixed(3),
      e.weightedDeltaKg.toFixed(3),
      Math.round(e.weightedDeltaVnd),
      direction,
    ].join(','));
  });

  // 7. Tally summary to stderr (so it doesn't pollute CSV).
  const totalImpactVnd = ranked.reduce((s, e) => s + Math.abs(e.weightedDeltaVnd), 0);
  console.error(`\n[audit-sku] top ${ranked.length} SKUs cover ${Math.round(totalImpactVnd).toLocaleString('vi-VN')} VND of |delta|`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => process.exit());
