/* eslint-disable no-console */
/**
 * Per-order / per-shipment audit view.
 *
 * Output is a long CSV that pivots cleanly in Sheets:
 *
 *   one row per (shipment × line item)
 *
 * with the parent order and shipment fields denormalised onto each
 * row. Single-shipment orders (98.8 % of meanblvd) attribute every
 * line to the only shipment. Multi-shipment orders attribute every
 * line to every shipment but mark them with `multi_ship_attribution`
 * so the operator knows the line could really belong to a different
 * shipment — Shopify fulfillment data isn't synced yet.
 *
 * Three quotes are shown for each shipment so the operator can read
 * the cause of the delta:
 *
 *   engine_at_reported_vnd  — engine quote using OUR reported weight
 *                              (what the customer was told at checkout)
 *   engine_at_actual_vnd    — engine quote using the CARRIER'S billed
 *                              weight (best-case — what we'd quote if
 *                              the variant weight were accurate)
 *   billed_vnd              — what the carrier actually charged
 *
 * Read the three together:
 *   engine_at_reported  ≈ billed  → weight was right, quote ok
 *   engine_at_actual    ≈ billed  → carrier behaves correctly, weight off
 *   engine_at_actual    ≠ billed  → surcharge/zone gap on top of weight
 *
 * Each row also carries the line's MASTER weight (synced from Shopify)
 * and that line's WEIGHT SHARE of the shipment, so the operator can see
 * which product is dragging the actual shipment heavier than expected.
 *
 * Usage:
 *   pnpm tsx scripts/audit-orders-shipments.ts > /Users/macos/Downloads/orders-shipments-audit.csv
 *   pnpm tsx scripts/audit-orders-shipments.ts --carrier dhl --limit 200
 */
import 'dotenv/config';
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { quote, type CarrierAccountSnapshot } from '@/features/carrier-rates/engine/quote';
import { loadAccountSnapshot } from '@/features/carrier-rates/engine/load';

interface Args {
  store: string;
  carrier?: 'fedex' | 'dhl';
  limit: number;
  /** Only emit rows where |delta| ≥ this in VND. Default 0 (everything). */
  minDelta: number;
}

function parseArgs(): Args {
  const a = process.argv.slice(2);
  const out: Args = {
    store: 'meanblvd.myshopify.com',
    limit: Number.POSITIVE_INFINITY,
    minDelta: 0,
  };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--store') out.store = a[++i];
    else if (a[i] === '--carrier') out.carrier = a[++i] as 'fedex' | 'dhl';
    else if (a[i] === '--limit') out.limit = Number(a[++i]);
    else if (a[i] === '--min-delta') out.minDelta = Number(a[++i]);
  }
  return out;
}

function csv(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

async function main(): Promise<void> {
  const args = parseArgs();

  // 1. Load every order in scope, joined to its shipments + charges.
  // No FILTER on label_created_at — operator can post-filter in
  // Sheets. We DO filter to orders that have at least one shipment
  // because we can't audit invoiceless orders.
  const shipmentRows = await db
    .select({
      orderId: schema.shopifyOrders.id,
      orderNumber: schema.shopifyOrders.shopifyOrderNumber,
      country: schema.shopifyOrders.shipCountry,
      postcode: schema.shopifyOrders.shipPostcode,
      city: schema.shopifyOrders.shipCity,
      reportedKg: schema.shopifyOrders.shipWeightKg,
      reportedKgOverride: schema.shopifyOrders.shipWeightKgOverride,
      processedAt: schema.shopifyOrders.processedAtShopify,
      shipmentId: schema.shipments.id,
      tracking: schema.shipments.trackingNumber,
      carrierKey: schema.shipments.carrierKey,
      actualKg: schema.shipments.actualWeightKg,
      dimL: schema.shipments.dimLengthCm,
      dimW: schema.shipments.dimWidthCm,
      dimH: schema.shipments.dimHeightCm,
      packaging: schema.shipments.packagingType,
      labelAt: schema.shipments.labelCreatedAt,
      billedTotal: schema.shipmentCharges.totalAmount,
      billedBase: schema.shipmentCharges.base,
      billedFuel: schema.shipmentCharges.fuel,
      billedRemote: schema.shipmentCharges.remote,
      billedDemand: schema.shipmentCharges.demand,
      billedVat: schema.shipmentCharges.vat,
      billedDiscount: schema.shipmentCharges.discount,
    })
    .from(schema.shipmentCharges)
    .innerJoin(schema.shipments, eq(schema.shipments.id, schema.shipmentCharges.shipmentId))
    .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.shipments.orderId))
    .innerJoin(schema.stores, eq(schema.stores.id, schema.shopifyOrders.storeId))
    .where(and(eq(schema.stores.shopDomain, args.store)));

  const filtered = shipmentRows.filter((r) => !args.carrier || r.carrierKey === args.carrier);
  console.error(`[audit-shipments] ${filtered.length} shipment rows in scope (${args.carrier ?? 'all carriers'})`);

  // 2. Group shipments by order so we know each order's total ship count.
  const shipmentsByOrder = new Map<string, typeof filtered>();
  for (const r of filtered) {
    const arr = shipmentsByOrder.get(r.orderId) ?? [];
    arr.push(r);
    shipmentsByOrder.set(r.orderId, arr);
  }

  // 3. Load every line for those orders + the master variant weight.
  const orderIds = [...shipmentsByOrder.keys()];
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

  // Master variant weight (grams) keyed by sku.
  const skus = [...new Set(lines.map((l) => l.sku).filter((s): s is string => !!s))];
  const variants = skus.length === 0 ? [] : await db
    .select({ sku: schema.shopifyVariants.sku, weightGrams: schema.shopifyVariants.weightGrams })
    .from(schema.shopifyVariants)
    .where(inArray(schema.shopifyVariants.sku, skus));
  const masterGramsBySku = new Map<string, number>();
  for (const v of variants) {
    if (v.sku && v.weightGrams !== null && !masterGramsBySku.has(v.sku)) {
      masterGramsBySku.set(v.sku, Number(v.weightGrams));
    }
  }

  // 4. Pre-load carrier snapshots (one per key).
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

  // 5. Walk every shipment, emit one CSV row per (shipment × line).
  const headers = [
    'order_number',
    'ship_index',
    'ship_count_for_order',
    'multi_ship_attribution',
    'tracking',
    'carrier',
    'country',
    'postcode',
    'city',
    'ship_actual_kg',
    'ship_expected_kg',
    'ship_reported_kg',
    'kg_actual_vs_expected',
    'engine_at_reported_vnd',
    'engine_at_actual_vnd',
    'billed_vnd',
    'delta_vnd',
    'billed_base_vnd',
    'billed_fuel_vnd',
    'billed_remote_vnd',
    'billed_demand_vnd',
    'billed_vat_vnd',
    'billed_discount_vnd',
    'sku',
    'product_title',
    'variant_title',
    'quantity',
    'line_master_kg',
    'line_weight_total_kg',
    'line_share_of_ship_pct',
  ];
  console.log(headers.join(','));

  let emitted = 0;
  for (const [orderId, orderShipments] of shipmentsByOrder) {
    if (emitted >= args.limit) break;
    const orderLines = (linesByOrder.get(orderId) ?? []).filter((l) => l.sku);
    if (orderLines.length === 0) continue;

    const totalMasterGrams = orderLines.reduce((s, l) => {
      const mg = masterGramsBySku.get(l.sku!);
      return s + (mg !== undefined ? mg * l.quantity : 0);
    }, 0);

    orderShipments.sort((a, b) =>
      (a.labelAt?.getTime() ?? 0) - (b.labelAt?.getTime() ?? 0),
    );
    const shipCount = orderShipments.length;

    for (let i = 0; i < orderShipments.length; i++) {
      const r = orderShipments[i];
      const reported = r.reportedKgOverride !== null
        ? Number(r.reportedKgOverride)
        : r.reportedKg !== null ? Number(r.reportedKg) : null;
      const actual = r.actualKg !== null ? Number(r.actualKg) : null;
      const snap = r.carrierKey ? snapsByKey.get(r.carrierKey) : undefined;
      const dims = (r.dimL && r.dimW && r.dimH)
        ? { lengthCm: Number(r.dimL), widthCm: Number(r.dimW), heightCm: Number(r.dimH) }
        : null;

      const eAtReported = snap && reported && r.country
        ? quote(snap, {
          weightKg: reported,
          dimensions: dims,
          packagingType: r.packaging,
          destinationCountry: r.country,
          destinationPostcode: r.postcode ?? undefined,
          destinationCity: r.city ?? undefined,
          effectiveDate: r.labelAt ?? r.processedAt ?? undefined,
        })
        : null;
      const eAtActual = snap && actual && r.country
        ? quote(snap, {
          weightKg: actual,
          dimensions: dims,
          packagingType: r.packaging,
          destinationCountry: r.country,
          destinationPostcode: r.postcode ?? undefined,
          destinationCity: r.city ?? undefined,
          effectiveDate: r.labelAt ?? r.processedAt ?? undefined,
        })
        : null;

      const engineAtReportedVnd = eAtReported?.ok ? eAtReported.breakdown.carrierCost : null;
      const engineAtActualVnd = eAtActual?.ok ? eAtActual.breakdown.carrierCost : null;
      const billedVnd = Number(r.billedTotal);
      // Delta vs engine_at_reported — that's what we quoted the customer.
      const deltaVnd = engineAtReportedVnd !== null ? billedVnd - engineAtReportedVnd : null;

      // Skip emission when the operator requested |delta| ≥ minDelta and
      // this shipment fits inside the noise floor. Saves CSV space.
      if (deltaVnd !== null && Math.abs(deltaVnd) < args.minDelta) continue;

      const multiAttribution = shipCount > 1
        ? 'MULTI_SHIP_LINES_ATTRIBUTED_TO_EVERY_SHIPMENT'
        : 'OK';

      // For single-shipment, the expected kg IS the order's master sum.
      // For multi-shipment we still show the order's full master sum on
      // each row but flag the attribution so the operator knows to
      // discount.
      const shipExpectedKg = totalMasterGrams / 1000;

      // Emit one row per line.
      for (const l of orderLines) {
        const masterG = masterGramsBySku.get(l.sku!);
        const masterKg = masterG !== undefined ? masterG / 1000 : null;
        const lineTotalKg = masterKg !== null ? masterKg * l.quantity : null;
        const shareOfShip = (lineTotalKg !== null && shipExpectedKg > 0)
          ? (lineTotalKg / shipExpectedKg) * 100
          : null;

        console.log([
          csv(r.orderNumber),
          i + 1,
          shipCount,
          multiAttribution,
          csv(r.tracking),
          r.carrierKey,
          r.country,
          csv(r.postcode),
          csv(r.city),
          actual?.toFixed(3) ?? '',
          shipExpectedKg.toFixed(3),
          reported?.toFixed(3) ?? '',
          (actual !== null && shipExpectedKg > 0) ? (actual - shipExpectedKg).toFixed(3) : '',
          engineAtReportedVnd !== null ? Math.round(engineAtReportedVnd) : '',
          engineAtActualVnd !== null ? Math.round(engineAtActualVnd) : '',
          Math.round(billedVnd),
          deltaVnd !== null ? Math.round(deltaVnd) : '',
          r.billedBase !== null ? Math.round(Number(r.billedBase)) : '',
          r.billedFuel !== null ? Math.round(Number(r.billedFuel)) : '',
          r.billedRemote !== null ? Math.round(Number(r.billedRemote)) : '',
          r.billedDemand !== null ? Math.round(Number(r.billedDemand)) : '',
          r.billedVat !== null ? Math.round(Number(r.billedVat)) : '',
          r.billedDiscount !== null ? Math.round(Number(r.billedDiscount)) : '',
          csv(l.sku),
          csv(l.productTitle),
          csv(l.variantTitle),
          l.quantity,
          masterKg !== null ? masterKg.toFixed(3) : '',
          lineTotalKg !== null ? lineTotalKg.toFixed(3) : '',
          shareOfShip !== null ? shareOfShip.toFixed(1) : '',
        ].join(','));
      }
      emitted++;
      if (emitted >= args.limit) break;
    }
  }

  console.error(`[audit-shipments] emitted ${emitted} shipment groups`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => process.exit());
