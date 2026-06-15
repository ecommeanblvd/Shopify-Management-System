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
import { diagnoseReconcileRow, type ReconcileDiagnosis } from './reconcile-diagnose';

export interface ReconcileRow {
  shipmentId: string;
  trackingNumber: string;
  orderNumber: string;
  storeName: string;
  carrierKey: string;
  shipCountry: string;
  shipCity: string | null;
  shipPostcode: string | null;
  /** Order weight synced from Shopify (sum of line variant weights). */
  shopifyWeightKg: number | null;
  /** Scale weight from the ops sheet (net weight). */
  weightKg: number | null;
  /** Weight the engine actually priced: max(actual, dim) after carrier
   *  rounding. NULL when the engine produced no quote. */
  chargeableKg: number | null;
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
  billedElevatedRisk: number | null;
  /** Billed import/clearance handling (ops col CK khi nằm trong tổng). */
  billedImportHandling: number | null;
  // Engine
  engineTotal: number | null;
  engineBase: number | null;
  engineFuel: number | null;
  /** Engine's weekly fuel % (carrier index) used for the quote. */
  engineFuelPercent: number | null;
  /** Implied billed fuel % = billedFuel / fuelable base. Base picked
   *  between (net base + remote) and (+ demand) — whichever lands closer
   *  to a clean carrier 0.25 %-step, since FedEx is inconsistent about
   *  fueling the demand surcharge. NULL when not computable. */
  billedFuelPercent: number | null;
  engineRemote: number | null;
  engineDemand: number | null;
  engineResidential: number | null;
  /** Premium (peak_fixed) — thường 0 (Direct Signature đã chuyển sang addon_fixed). */
  enginePeak: number | null;
  /** Dịch vụ bổ sung apply_mode='always' (DHL Direct Signature). 0/null for FedEx. */
  engineAddons: number | null;
  /** DHL GoGreen (per_step_fixed). 0/null for FedEx. */
  enginePerStep: number | null;
  /** DHL Elevated Risk / Restricted Destination (country_fixed). */
  engineCountryFixed: number | null;
  engineVat: number | null;
  engineDiscount: number | null;
  engineReason: string | null;
  // Delta
  deltaVnd: number | null;
  deltaPct: number | null;
  // Per-dong invoice diagnosis (null when engine could not quote).
  diagnosis: ReconcileDiagnosis | null;
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
      billedElevatedRisk: schema.shipmentCharges.elevatedRisk,
      billedImportHandling: schema.shipmentCharges.importHandling,
      // order
      orderNumber: schema.shopifyOrders.shopifyOrderNumber,
      shipCountry: schema.shopifyOrders.shipCountry,
      shipCity: schema.shopifyOrders.shipCity,
      shipPostcode: schema.shopifyOrders.shipPostcode,
      shipWeightKgOverride: schema.shopifyOrders.shipWeightKgOverride,
      shopifyWeightKg: schema.shopifyOrders.shipWeightKg,
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

  // All-zone NET ladders per snapshot (for the cross-zone inversion in the
  // diagnosis). Built once per card snapshot — zonesByCountry shares one
  // ZoneSnap object per zone, so dedupe by label.
  type Snap = NonNullable<Awaited<ReturnType<typeof loadAccountSnapshot>>>;
  const zoneLaddersBySnap = new Map<object, Array<{ zoneLabel: string; rates: Array<{ upperKg: number; rate: number }> }>>();
  const allZoneLadders = (snap: Snap): Array<{ zoneLabel: string; rates: Array<{ upperKg: number; rate: number }> }> => {
    const hit = zoneLaddersBySnap.get(snap as object);
    if (hit) return hit;
    const seen = new Map<string, { zoneLabel: string; rates: Array<{ upperKg: number; rate: number }> }>();
    for (const z of snap.zonesByCountry.values()) {
      if (seen.has(z.label)) continue;
      const rates: Array<{ upperKg: number; rate: number }> = [];
      for (const t of snap.weightTiers) {
        const pkg = z.rateByTierUpper.get(t.upperKg);
        const pak = z.pakRateByTierUpper?.get(t.upperKg);
        if (pkg != null) rates.push({ upperKg: t.upperKg, rate: pkg });
        if (pak != null && pak !== pkg) rates.push({ upperKg: t.upperKg, rate: pak });
      }
      seen.set(z.label, { zoneLabel: z.label, rates });
    }
    const out = [...seen.values()];
    zoneLaddersBySnap.set(snap as object, out);
    return out;
  };

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
      // ODA/remote lookup needs the postcode (DE/NL/US…) or city
      // (SA/KW/AE…) — without them every remote-billed shipment
      // misdiagnosed as 'thiếu cấu hình vùng xa'.
      destinationPostcode: r.shipPostcode ?? undefined,
      destinationCity: r.shipCity ?? undefined,
      effectiveDate: r.labelCreatedAt ?? r.processedAtShopify ?? undefined,
      // Đơn có ký nhận = bill đã thu (billedSignature>0) → engine tính phí ký
      // nhận thật (when_billed → vào total + fuel + VAT) thay vì chỉ tham chiếu,
      // để khớp đúng với hoá đơn quá khứ.
      signatureOptIn: Number(r.billedSignature ?? 0) > 0,
    });

    if (!q.ok) {
      unmatched += 1;
      rows.push(buildRow(r, null, q.code));
      continue;
    }

    matched += 1;
    sumEngine += q.breakdown.carrierCost;

    // Build the package-appropriate gross list rate ladder for this zone so
    // the diagnosis can invert the billed base back to a weight tier.
    const zone = snap.zonesByCountry.get(r.shipCountry);
    // Include BOTH the Package and Pak list rates per tier — we don't know
    // which packaging the carrier billed at, so the inversion must be able to
    // match either ladder.
    const zoneRates = zone
      ? snap.weightTiers.flatMap((t) => {
          const out: Array<{ upperKg: number; rate: number }> = [];
          const pkg = zone.rateByTierUpper.get(t.upperKg);
          const pak = zone.pakRateByTierUpper?.get(t.upperKg);
          if (pkg != null) out.push({ upperKg: t.upperKg, rate: pkg });
          if (pak != null && pak !== pkg) out.push({ upperKg: t.upperKg, rate: pak });
          return out;
        })
      : [];
    // remote_fixed is fuelable by default in the engine — include it in the
    // billed fuelable base so the implied fuel % comparison is apples-to-apples.
    // NET basis: the carrier computes fuel on the post-discount base (verified
    // #MBLVD28869 et al.), and FedEx invoices express base as list + negative
    // discount — so fold the discount in.
    const billedFuelableBase = Number(r.billedBase ?? 0) + Number(r.billedDiscount ?? 0)
      + Number(r.billedRemote ?? 0);
    const diagnosis = diagnoseReconcileRow({
      billed: {
        base: r.billedBase != null ? Number(r.billedBase) : null,
        discount: r.billedDiscount != null ? Number(r.billedDiscount) : null,
        fuel: r.billedFuel != null ? Number(r.billedFuel) : null,
        remote: r.billedRemote != null ? Number(r.billedRemote) : null,
        demand: r.billedDemand != null ? Number(r.billedDemand) : null,
        signature: r.billedSignature != null ? Number(r.billedSignature) : null,
        vat: r.billedVat != null ? Number(r.billedVat) : null,
        gogreen: r.billedGogreen != null ? Number(r.billedGogreen) : null,
        elevatedRisk: r.billedElevatedRisk != null ? Number(r.billedElevatedRisk) : null,
        importHandling: r.billedImportHandling != null ? Number(r.billedImportHandling) : null,
        total: Number(r.billedTotal),
      },
      engine: {
        base: q.breakdown.base,
        discount: q.breakdown.discount,
        fuel: q.breakdown.fuel,
        remote: q.breakdown.remote,
        demand: q.breakdown.demand,
        residential: q.breakdown.residential,
        peak: q.breakdown.peak,
        addons: q.breakdown.addons,
        addonReference: q.breakdown.addonReference,
        addonExcludedForCountry: q.breakdown.addonExcludedForCountry,
        perStep: q.breakdown.perStep,
        countryFixed: q.breakdown.countryFixed,
        countryFixedReference: q.breakdown.countryFixedReference,
        vat: q.breakdown.vat,
        total: q.breakdown.carrierCost,
      },
      engineChargeableWeightKg: q.breakdown.chargeableWeightKg,
      engineTierUpperKg: q.tier.upperKg,
      zoneRates,
      engineZoneLabel: zone?.label ?? '',
      otherZoneRates: allZoneLadders(snap).filter((z) => z.zoneLabel !== zone?.label),
      billedFuelableBase,
      fuelPercent: q.breakdown.fuelPercent,
      discountPercent: q.breakdown.discountPercent,
      vatPercent: q.breakdown.vatPercent,
      shipCountry: r.shipCountry,
    });
    rows.push(buildRow(r, q.breakdown, null, diagnosis));
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
  shipCity?: string | null;
  shipPostcode?: string | null;
  actualWeightKg: string | null;
  shopifyWeightKg?: string | null;
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
  billedElevatedRisk: string | null;
  billedImportHandling?: string | null;
}

interface EngineBreakdown {
  chargeableWeightKg: number;
  countryFixed: number;
  fuelPercent: number;
  base: number;
  fuel: number;
  remote: number;
  demand: number;
  residential: number;
  peak: number;
  addons: number;
  perStep: number;
  vat: number;
  discount: number;
  carrierCost: number;
}

/**
 * Implied % the carrier actually applied: billedFuel / fuelable base.
 * The carrier base = net base + remote + (per-carrier subset of demand
 * and signature) — FedEx fuels signature + demand, DHL doesn't. Tries
 * every combination; a candidate within 0.05 pp of the engine's weekly
 * %% wins outright (that's the authoritative index), otherwise the one
 * closest to a clean 0.25 %-step.
 */
function impliedBilledFuelPercent(r: JoinedRow, enginePct: number | null): number | null {
  const fuel = r.billedFuel != null ? Number(r.billedFuel) : 0;
  if (fuel <= 0) return null;
  const netBase = Number(r.billedBase ?? 0) + Number(r.billedDiscount ?? 0);
  const remote = Number(r.billedRemote ?? 0);
  const demand = Number(r.billedDemand ?? 0);
  const signature = Number(r.billedSignature ?? 0);
  // DHL fuels the Elevated Risk (country_fixed) too — include it in the
  // combinations (verified #MBLVD27457-cohort: 30.5% × (base + ER)).
  const er = Number(r.billedElevatedRisk ?? 0) + Number(r.billedImportHandling ?? 0);
  const c0 = netBase + remote;
  const adds = [demand, signature, er];
  const candidates = [...new Set(
    Array.from({ length: 8 }, (_, mask) =>
      c0 + adds.reduce((sum, a, i) => sum + ((mask >> i) & 1 ? a : 0), 0)),
  )].filter((b) => b > 0);
  let best: number | null = null;
  let bestDist = Infinity;
  for (const base of candidates) {
    const pct = (fuel / base) * 100;
    if (enginePct !== null && Math.abs(pct - enginePct) < 0.05) {
      best = pct;
      break;
    }
    const dist = Math.abs(pct - Math.round(pct * 4) / 4);
    if (dist < bestDist) { bestDist = dist; best = pct; }
  }
  return best !== null ? Math.round(best * 100) / 100 : null;
}

function buildRow(
  r: JoinedRow,
  engine: EngineBreakdown | null,
  unmatchedReason: string | null,
  diagnosis: ReconcileDiagnosis | null = null,
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
    shipCity: r.shipCity ?? null,
    shipPostcode: r.shipPostcode ?? null,
    shopifyWeightKg: r.shopifyWeightKg != null ? Number(r.shopifyWeightKg) : null,
    weightKg: r.actualWeightKg !== null ? Number(r.actualWeightKg) : null,
    chargeableKg: engine?.chargeableWeightKg ?? null,
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
    billedElevatedRisk: r.billedElevatedRisk !== null ? Number(r.billedElevatedRisk) : null,
    billedImportHandling: r.billedImportHandling != null ? Number(r.billedImportHandling) : null,
    engineTotal,
    engineBase: engine?.base ?? null,
    engineFuel: engine?.fuel ?? null,
    engineFuelPercent: engine?.fuelPercent ?? null,
    billedFuelPercent: impliedBilledFuelPercent(r, engine?.fuelPercent ?? null),
    engineRemote: engine?.remote ?? null,
    engineDemand: engine?.demand ?? null,
    engineResidential: engine?.residential ?? null,
    enginePeak: engine?.peak ?? null,
    engineAddons: engine?.addons ?? null,
    enginePerStep: engine?.perStep ?? null,
    engineCountryFixed: engine?.countryFixed ?? null,
    engineVat: engine?.vat ?? null,
    engineDiscount: engine?.discount ?? null,
    engineReason: unmatchedReason,
    deltaVnd,
    deltaPct,
    diagnosis,
  };
}
