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
import { listRateCards, pickRateCardForDate, type RateCardWindow } from '@/features/carrier-rates/engine/rate-cards';

export interface ReconcileRow {
  shipmentId: string;
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
  billedRemote: number | null;
  billedDemand: number | null;
  billedSignature: number | null;
  billedVat: number | null;
  billedGogreen: number | null;
  billedDiscount: number | null;
  // Engine
  engineTotal: number | null;
  engineBase: number | null;
  engineFuel: number | null;
  engineRemote: number | null;
  engineDemand: number | null;
  engineResidential: number | null;
  engineVat: number | null;
  engineDiscount: number | null;
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
      billedRemote: schema.shipmentCharges.remote,
      billedDemand: schema.shipmentCharges.demand,
      billedSignature: schema.shipmentCharges.directSignature,
      billedVat: schema.shipmentCharges.vat,
      billedGogreen: schema.shipmentCharges.gogreen,
      billedDiscount: schema.shipmentCharges.discount,
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

  // 2. Pre-load one snapshot PER rate card, grouped by carrier key.
  // A carrier (fedex/dhl) has one account; that account has N dated cards.
  // We load each card's snapshot once, then pick by ship date in the loop.
  const accounts = await db
    .select({ id: schema.carrierAccounts.id, key: schema.carriers.key })
    .from(schema.carrierAccounts)
    .leftJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId))
    .where(eq(schema.carrierAccounts.enabled, true));

  interface CarrierCards {
    cards: RateCardWindow[];
    snapByCard: Map<string, Awaited<ReturnType<typeof loadAccountSnapshot>>>;
  }
  const byKey = new Map<string, CarrierCards>();
  for (const a of accounts) {
    if (a.key !== 'fedex' && a.key !== 'dhl') continue;
    const cards = await listRateCards(a.id);
    const snapByCard = new Map<string, Awaited<ReturnType<typeof loadAccountSnapshot>>>();
    for (const c of cards) {
      // Anchor load to the card's own start date so it resolves that card.
      snapByCard.set(c.id, await loadAccountSnapshot(a.id, c.effectiveFrom));
    }
    byKey.set(a.key, { cards, snapByCard });
  }

  const rows: ReconcileRow[] = [];
  let matched = 0, unmatched = 0;
  let sumBilled = 0, sumEngine = 0;

  for (const r of filtered) {
    const shipDate = r.labelCreatedAt ?? r.processedAtShopify ?? null;
    const entry = r.carrierKey ? byKey.get(r.carrierKey) : undefined;
    const card = entry && shipDate ? pickRateCardForDate(entry.cards, shipDate) : null;
    const snap = card ? entry!.snapByCard.get(card.id) ?? null : null;
    const billedTotal = Number(r.billedTotal);
    sumBilled += billedTotal;

    if (!entry || !shipDate || !card) {
      unmatched += 1;
      rows.push(buildRow(r, null, !shipDate ? 'no_ship_date' : 'no_rate_card'));
      continue;
    }
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
  shipmentId: string;
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
  billedRemote: string | null;
  billedDemand: string | null;
  billedSignature: string | null;
  billedVat: string | null;
  billedGogreen: string | null;
  billedDiscount: string | null;
}

interface EngineBreakdown {
  base: number;
  fuel: number;
  remote: number;
  demand: number;
  residential: number;
  vat: number;
  discount: number;
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
    shipmentId: r.shipmentId,
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
    billedRemote: r.billedRemote !== null ? Number(r.billedRemote) : null,
    billedDemand: r.billedDemand !== null ? Number(r.billedDemand) : null,
    billedSignature: r.billedSignature !== null ? Number(r.billedSignature) : null,
    billedVat: r.billedVat !== null ? Number(r.billedVat) : null,
    billedGogreen: r.billedGogreen !== null ? Number(r.billedGogreen) : null,
    billedDiscount: r.billedDiscount !== null ? Number(r.billedDiscount) : null,
    engineTotal,
    engineBase: engine?.base ?? null,
    engineFuel: engine?.fuel ?? null,
    engineRemote: engine?.remote ?? null,
    engineDemand: engine?.demand ?? null,
    engineResidential: engine?.residential ?? null,
    engineVat: engine?.vat ?? null,
    engineDiscount: engine?.discount ?? null,
    engineReason: unmatchedReason,
    deltaVnd,
    deltaPct,
  };
}
