/**
 * Per-shipment reconciliation: run the carrier engine for each
 * imported shipment_charge and emit a side-by-side delta vs the
 * actual billed amount.
 *
 * Output is sorted by ABS(delta) descending so the operator sees the
 * worst-fitting rows first — those are either (a) data-quality issues
 * we should fix (missing remote postcode, wrong weight) or (b)
 * carrier behaviour the engine doesn't model yet.
 */

import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { quote } from '@/features/carrier-rates/engine/quote';
import { loadAccountSnapshot } from '@/features/carrier-rates/engine/load';

export interface ReconcileRow {
  trackingNumber: string;
  orderNumber: string;
  storeName: string;
  carrierKey: string;
  shipCountry: string;
  weightKg: number | null;
  labelDate: Date | null;
  // Billed
  billedTotal: number;
  billedBase: number | null;
  billedFuel: number | null;
  // Engine
  engineTotal: number | null;
  engineBase: number | null;
  engineFuel: number | null;
  engineReason: string | null;
  // Delta
  deltaVnd: number | null;
  deltaPct: number | null;
}

export interface ReconcileSummary {
  totalShipments: number;
  matched: number;       // engine produced a quote
  unmatched: number;     // engine returned "unknown" reason
  totals: {
    billed: number;
    engine: number;
    deltaVnd: number;
    deltaPct: number;
  };
  rows: ReconcileRow[];
}

interface ReconcileOptions {
  /** Filter by carrier key — undefined = both. */
  carrierKey?: 'fedex' | 'dhl';
  /** Restrict to a date range on `shipments.label_created_at`. */
  fromDate?: Date;
  toDate?: Date;
  /** Cap returned rows. Default 100 (top-N by abs delta). */
  topN?: number;
}

/**
 * Run reconciliation across every (shipment, shipment_charge) pair.
 *
 * Pre-loads carrier snapshots ONCE (one per carrier_key) so the loop
 * is pure compute — no per-row DB chatter. Same pattern the
 * dashboard's batch estimator uses.
 */
export async function reconcileShipments(opts: ReconcileOptions = {}): Promise<ReconcileSummary> {
  // 1. Pull every (shipment, charge, order, store) we want to reconcile.
  const all = await db
    .select({
      shipmentId: schema.shipments.id,
      trackingNumber: schema.shipments.trackingNumber,
      carrierKey: schema.shipments.carrierKey,
      dimLengthCm: schema.shipments.dimLengthCm,
      dimWidthCm: schema.shipments.dimWidthCm,
      dimHeightCm: schema.shipments.dimHeightCm,
      actualWeightKg: schema.shipments.actualWeightKg,
      packagingType: schema.shipments.packagingType,
      labelCreatedAt: schema.shipments.labelCreatedAt,
      // charge
      chargeId: schema.shipmentCharges.id,
      billedTotal: schema.shipmentCharges.totalAmount,
      billedBase: schema.shipmentCharges.base,
      billedFuel: schema.shipmentCharges.fuel,
      // order
      orderNumber: schema.shopifyOrders.shopifyOrderNumber,
      shipCountry: schema.shopifyOrders.shipCountry,
      shipWeightKgOverride: schema.shopifyOrders.shipWeightKgOverride,
      processedAtShopify: schema.shopifyOrders.processedAtShopify,
      // store
      storeName: schema.stores.name,
    })
    .from(schema.shipmentCharges)
    .innerJoin(schema.shipments, eq(schema.shipments.id, schema.shipmentCharges.shipmentId))
    .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.shipments.orderId))
    .innerJoin(schema.stores, eq(schema.stores.id, schema.shopifyOrders.storeId));

  const filtered = all.filter((r) => {
    if (opts.carrierKey && r.carrierKey !== opts.carrierKey) return false;
    if (opts.fromDate && r.labelCreatedAt && r.labelCreatedAt < opts.fromDate) return false;
    if (opts.toDate && r.labelCreatedAt && r.labelCreatedAt > opts.toDate) return false;
    return true;
  });

  // 2. Pre-load snapshots, one per carrier brand.
  const carriers = await db
    .select({ id: schema.carrierAccounts.id, key: schema.carriers.key })
    .from(schema.carrierAccounts)
    .leftJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId))
    .where(eq(schema.carrierAccounts.enabled, true));
  const snapsByKey = new Map<string, Awaited<ReturnType<typeof loadAccountSnapshot>>>();
  for (const c of carriers) {
    if (c.key && (c.key === 'fedex' || c.key === 'dhl')) {
      snapsByKey.set(c.key, await loadAccountSnapshot(c.id));
    }
  }

  const rows: ReconcileRow[] = [];
  let matched = 0, unmatched = 0;
  let sumBilled = 0, sumEngine = 0;

  for (const r of filtered) {
    const snap = r.carrierKey ? snapsByKey.get(r.carrierKey) : null;
    const billedTotal = Number(r.billedTotal);
    sumBilled += billedTotal;

    if (!snap || !r.shipCountry) {
      unmatched += 1;
      rows.push(buildRow(r, null, 'no_snapshot_or_country'));
      continue;
    }

    // Weight: prefer operator override on the order, then shipment's
    // actualWeight. Matches the dashboard quoting flow.
    const weightKg = r.shipWeightKgOverride !== null
      ? Number(r.shipWeightKgOverride)
      : r.actualWeightKg !== null ? Number(r.actualWeightKg) : null;
    if (!weightKg || weightKg <= 0) {
      unmatched += 1;
      rows.push(buildRow(r, null, 'no_weight'));
      continue;
    }

    const dims = (r.dimLengthCm && r.dimWidthCm && r.dimHeightCm)
      ? {
        lengthCm: Number(r.dimLengthCm),
        widthCm: Number(r.dimWidthCm),
        heightCm: Number(r.dimHeightCm),
      }
      : null;

    const q = quote(snap, {
      weightKg,
      dimensions: dims,
      packagingType: r.packagingType,
      destinationCountry: r.shipCountry,
      effectiveDate: r.labelCreatedAt ?? r.processedAtShopify ?? undefined,
    });

    if (!q.ok) {
      unmatched += 1;
      rows.push(buildRow(r, null, q.code));
      continue;
    }

    matched += 1;
    sumEngine += q.breakdown.carrierCost;
    rows.push(buildRow(r, q.breakdown, null));
  }

  // 3. Sort by absolute delta descending — operator sees worst fits first.
  rows.sort((a, b) => Math.abs(b.deltaVnd ?? 0) - Math.abs(a.deltaVnd ?? 0));

  const topN = opts.topN ?? 100;
  const deltaVnd = sumBilled - sumEngine;
  const deltaPct = sumBilled > 0 ? (deltaVnd / sumBilled) * 100 : 0;

  return {
    totalShipments: filtered.length,
    matched,
    unmatched,
    totals: {
      billed: sumBilled,
      engine: sumEngine,
      deltaVnd,
      deltaPct,
    },
    rows: rows.slice(0, topN),
  };
}

interface JoinedRow {
  // shipments.tracking_number is nullable in DB (label not yet
  // generated for pre-ship rows), but every row we reach in
  // reconcile() has one — the import path requires it.
  trackingNumber: string | null;
  orderNumber: string;
  storeName: string;
  carrierKey: string | null;
  shipCountry: string | null;
  actualWeightKg: string | null;
  labelCreatedAt: Date | null;
  billedTotal: string;
  billedBase: string | null;
  billedFuel: string | null;
}

interface EngineBreakdown {
  base: number;
  fuel: number;
  carrierCost: number;
}

function buildRow(
  r: JoinedRow,
  engine: EngineBreakdown | null,
  unmatchedReason: string | null,
): ReconcileRow {
  const billedTotal = Number(r.billedTotal);
  const engineTotal = engine?.carrierCost ?? null;
  const deltaVnd = engineTotal !== null ? billedTotal - engineTotal : null;
  const deltaPct = (deltaVnd !== null && billedTotal > 0)
    ? (deltaVnd / billedTotal) * 100
    : null;
  return {
    trackingNumber: r.trackingNumber ?? '',
    orderNumber: r.orderNumber,
    storeName: r.storeName,
    carrierKey: r.carrierKey ?? '',
    shipCountry: r.shipCountry ?? '',
    weightKg: r.actualWeightKg !== null ? Number(r.actualWeightKg) : null,
    labelDate: r.labelCreatedAt,
    billedTotal,
    billedBase: r.billedBase !== null ? Number(r.billedBase) : null,
    billedFuel: r.billedFuel !== null ? Number(r.billedFuel) : null,
    engineTotal,
    engineBase: engine?.base ?? null,
    engineFuel: engine?.fuel ?? null,
    engineReason: unmatchedReason,
    deltaVnd,
    deltaPct,
  };
}
