/* eslint-disable no-console */
/**
 * Audit script for meanblvd carrier invoices vs the engine's quote.
 *
 * For every (shipment, shipment_charge) on the meanblvd store we
 *
 *   1. Re-run the carrier engine against the order's reported weight
 *      and dimensions to produce an "engine-expected" breakdown.
 *
 *   2. Reverse the carrier's contract discount on the billed base to
 *      recover the publish-price the carrier actually charged:
 *          listBase = billed_base + billed_discount       // discount is negative
 *      then walk the zone's rateByTierUpper map to find which tier
 *      upper-kg matches that list price. That tier's upper-kg is the
 *      "carrier-implied weight" — what the carrier actually billed.
 *
 *   3. Compare each surcharge bucket (fuel, remote, demand, vat,
 *      country_fixed) billed vs engine and flag the gap.
 *
 *   4. Classify each row:
 *        WEIGHT_OFF       — implied weight is one tier (or more) above
 *                            what we estimated → variant weight is too low
 *        MISSING_REMOTE   — carrier billed a remote surcharge, engine
 *                            didn't → destination not flagged in DB
 *        MISSING_DEMAND   — carrier billed a demand surcharge, engine
 *                            didn't → country list incomplete
 *        SURCHARGE_OTHER  — gap in some other bucket
 *        MATCHED          — within tolerance, no signal
 *        UNCLASSIFIED     — can't pin a single cause
 *
 *   5. Print top-N findings sorted by ABS(delta) so operator focuses on
 *      the worst-fitting rows first.
 *
 * Read-only — no DB writes. Optional --limit and --top flags.
 */
import 'dotenv/config';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { quote, type QuoteBreakdown, type CarrierAccountSnapshot } from '@/features/carrier-rates/engine/quote';
import { loadAccountSnapshot } from '@/features/carrier-rates/engine/load';

interface Args {
  store: string;
  limit: number;
  top: number;
  carrier?: 'fedex' | 'dhl';
  /** Tolerance in VND for "MATCHED" — total |delta| under this counts as OK. */
  matchedTol: number;
  /** Tolerance % of list price when reverse-matching a tier's base price. */
  reverseTolPct: number;
}

function parseArgs(): Args {
  const a = process.argv.slice(2);
  const out: Args = {
    store: 'meanblvd.myshopify.com',
    limit: Number.POSITIVE_INFINITY,
    top: 30,
    matchedTol: 50_000,
    reverseTolPct: 2,
  };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--store') out.store = a[++i];
    else if (a[i] === '--limit') out.limit = Number(a[++i]);
    else if (a[i] === '--top') out.top = Number(a[++i]);
    else if (a[i] === '--carrier') out.carrier = a[++i] as 'fedex' | 'dhl';
    else if (a[i] === '--matched-tol') out.matchedTol = Number(a[++i]);
    else if (a[i] === '--reverse-tol-pct') out.reverseTolPct = Number(a[++i]);
  }
  return out;
}

type Category =
  | 'WEIGHT_UNDER'    // implied tier > reported → product weight underestimated
  | 'WEIGHT_OVER'     // implied tier < reported → overestimated (we eat extra cost in quotes)
  | 'MISSING_REMOTE'
  | 'MISSING_DEMAND'
  | 'EXTRA_REMOTE'    // engine added remote, carrier didn't bill it
  | 'SURCHARGE_OTHER'
  | 'MATCHED'
  | 'UNCLASSIFIED';

interface Finding {
  tracking: string;
  orderNumber: string;
  carrier: string;
  country: string;
  postcode: string | null;
  city: string | null;
  /** Operator-reported weight on the order. */
  reportedWeightKg: number | null;
  /** Carrier-billed weight on the shipment. */
  actualWeightKg: number | null;
  /** Weight implied by reversing the billed list base against the rate sheet. */
  impliedWeightKg: number | null;
  /** Lowest tier upperKg that matches (for context). */
  impliedTierUpperKg: number | null;

  billedTotal: number;
  engineTotal: number | null;
  delta: number;

  // Per-bucket gaps (billed - engine), null when engine couldn't quote
  gap: {
    base: number | null;
    fuel: number | null;
    remote: number | null;
    demand: number | null;
    vat: number | null;
    countryFixed: number | null;
  };

  category: Category;
  note: string;
}

/**
 * Reverse-lookup: given the carrier-NET base (carrier_list + discount)
 * for this shipment, iterate the zone's tier rates and return the
 * smallest upper-kg whose POST-DISCOUNT rate is within `tolPct` of the
 * input.
 *
 * Why net-vs-net: shipment_charges.base is the carrier's published
 * LIST price (FedEx prints LIST then applies a contract discount line).
 * Our rate sheet rows already store NET (post-discount) prices. To
 * make them comparable we apply the same discount % the engine
 * computed for the quote.
 */
function impliedTier(
  snap: CarrierAccountSnapshot,
  country: string,
  carrierNetBase: number,
  discountPercent: number,
  tolPct: number,
): { upperKg: number; netRate: number } | null {
  const zone = snap.zonesByCountry.get(country);
  if (!zone) return null;
  const dFrac = Math.max(0, Math.min(99, discountPercent)) / 100;
  let bestMatch: { upperKg: number; netRate: number; gapPct: number } | null = null;
  for (const [upperKg, listRate] of zone.rateByTierUpper) {
    const netRate = listRate * (1 - dFrac);
    const gapPct = Math.abs(netRate - carrierNetBase) / Math.max(netRate, 1) * 100;
    if (gapPct > tolPct) continue;
    if (!bestMatch || upperKg < bestMatch.upperKg) {
      bestMatch = { upperKg, netRate, gapPct };
    }
  }
  return bestMatch ? { upperKg: bestMatch.upperKg, netRate: bestMatch.netRate } : null;
}

function classify(
  reported: number | null,
  implied: number | null,
  gap: Finding['gap'],
  delta: number,
  matchedTol: number,
): { category: Category; note: string } {
  if (Math.abs(delta) <= matchedTol) {
    return { category: 'MATCHED', note: 'within tolerance' };
  }

  // Weight under-estimation: carrier priced against a heavier tier.
  // The carrier's chargeable weight rounds UP, so 1.6 kg → 2.0 kg
  // tier — only flag when the gap exceeds half a tier-step to avoid
  // false positives at borderline weights.
  if (implied !== null && reported !== null && implied > reported * 1.10) {
    const diff = implied - reported;
    return {
      category: 'WEIGHT_UNDER',
      note: `carrier billed for ~${implied.toFixed(1)} kg tier, we reported ${reported.toFixed(3)} kg → underestimated by ${diff.toFixed(2)} kg`,
    };
  }

  // Weight over-estimation: we said heavier than the carrier billed
  // for. Lower priority because it costs us nothing on the invoice —
  // but it means our customer-facing quotes for similar products are
  // too high, eroding conversion.
  if (implied !== null && reported !== null && reported > implied * 1.10) {
    const diff = reported - implied;
    return {
      category: 'WEIGHT_OVER',
      note: `carrier billed for ~${implied.toFixed(1)} kg tier, we reported ${reported.toFixed(3)} kg → overestimated by ${diff.toFixed(2)} kg`,
    };
  }

  // Engine added a remote fee the carrier never billed — over-quote.
  // Common cause: our remote_postcodes list has false positives
  // (e.g. DHL classified a postcode that the actual delivery wasn't).
  if ((gap.remote ?? 0) < -matchedTol) {
    return {
      category: 'EXTRA_REMOTE',
      note: `engine added remote ${(-gap.remote!).toLocaleString('vi-VN')} VND not billed — destination probably not actually remote`,
    };
  }

  // Missing remote: carrier added a remote fee, our engine didn't.
  if ((gap.remote ?? 0) > matchedTol) {
    return {
      category: 'MISSING_REMOTE',
      note: `carrier remote ${gap.remote!.toLocaleString('vi-VN')} VND not modelled — destination not flagged in carrier_remote_postcodes`,
    };
  }

  // Missing demand: carrier added a demand fee, our engine didn't.
  if ((gap.demand ?? 0) > matchedTol) {
    return {
      category: 'MISSING_DEMAND',
      note: `carrier demand ${gap.demand!.toLocaleString('vi-VN')} VND not modelled — country missing from demand_per_kg list`,
    };
  }

  // Catch-all surcharge gap.
  const surGaps = [
    { name: 'fuel', v: gap.fuel ?? 0 },
    { name: 'vat', v: gap.vat ?? 0 },
    { name: 'countryFixed', v: gap.countryFixed ?? 0 },
  ].filter((g) => Math.abs(g.v) > matchedTol);
  if (surGaps.length > 0) {
    const worst = surGaps.sort((a, b) => Math.abs(b.v) - Math.abs(a.v))[0];
    return {
      category: 'SURCHARGE_OTHER',
      note: `${worst.name} gap ${worst.v.toLocaleString('vi-VN')} VND`,
    };
  }

  return { category: 'UNCLASSIFIED', note: 'delta present but no bucket explains it cleanly' };
}

async function main(): Promise<void> {
  const args = parseArgs();
  console.log(`[audit] store=${args.store} carrier=${args.carrier ?? 'all'} top=${args.top}`);

  // Load all (shipment, charge, order, store) joined.
  const rows = await db
    .select({
      tracking: schema.shipments.trackingNumber,
      carrierKey: schema.shipments.carrierKey,
      actualWeight: schema.shipments.actualWeightKg,
      dimL: schema.shipments.dimLengthCm,
      dimW: schema.shipments.dimWidthCm,
      dimH: schema.shipments.dimHeightCm,
      packaging: schema.shipments.packagingType,
      labelAt: schema.shipments.labelCreatedAt,
      // charge
      billedTotal: schema.shipmentCharges.totalAmount,
      billedBase: schema.shipmentCharges.base,
      billedFuel: schema.shipmentCharges.fuel,
      billedRemote: schema.shipmentCharges.remote,
      billedDemand: schema.shipmentCharges.demand,
      billedVat: schema.shipmentCharges.vat,
      billedDiscount: schema.shipmentCharges.discount,
      // order
      orderNumber: schema.shopifyOrders.shopifyOrderNumber,
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

  const filtered = rows.filter((r) => {
    if (args.carrier && r.carrierKey !== args.carrier) return false;
    return true;
  });
  console.log(`[audit] ${filtered.length} shipment_charges in scope`);

  // Pre-load enabled FedEx + DHL snapshots once.
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
  console.log(`[audit] loaded ${snapsByKey.size} carrier snapshots`);

  const findings: Finding[] = [];
  let processed = 0;
  const counts: Record<Category, number> = {
    WEIGHT_UNDER: 0, WEIGHT_OVER: 0,
    MISSING_REMOTE: 0, EXTRA_REMOTE: 0, MISSING_DEMAND: 0,
    SURCHARGE_OTHER: 0, MATCHED: 0, UNCLASSIFIED: 0,
  };
  let sumBilled = 0, sumEngine = 0;

  for (const r of filtered) {
    if (processed >= args.limit) break;
    processed++;

    const billedTotal = Number(r.billedTotal);
    sumBilled += billedTotal;
    const reported = r.reportedWeightOverride !== null
      ? Number(r.reportedWeightOverride)
      : r.reportedWeight !== null ? Number(r.reportedWeight) : null;
    const actual = r.actualWeight !== null ? Number(r.actualWeight) : null;
    const snap = r.carrierKey ? snapsByKey.get(r.carrierKey) : undefined;

    // 1. Quote engine with the operator-reported weight.
    let engineB: QuoteBreakdown | null = null;
    if (snap && reported && reported > 0 && r.country) {
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
      if (q.ok) engineB = q.breakdown;
    }
    const engineTotal = engineB?.carrierCost ?? null;
    if (engineTotal !== null) sumEngine += engineTotal;
    const delta = engineTotal === null ? billedTotal : billedTotal - engineTotal;

    // 2. Reverse-lookup tier from billed NET base.
    // Carrier prints LIST then applies a discount line — net = list +
    // discount (discount is stored negative). Our rate sheet stores
    // NET (post-contract-discount) prices, so we re-derive each tier's
    // net using the engine's computed discount % to keep the
    // comparison apples-to-apples.
    const billedBaseNum = r.billedBase !== null ? Number(r.billedBase) : 0;
    const billedDiscountNum = r.billedDiscount !== null ? Number(r.billedDiscount) : 0;
    const carrierNetBase = billedBaseNum + billedDiscountNum;
    let impliedKg: number | null = null;
    let impliedTierKg: number | null = null;
    if (snap && r.country && carrierNetBase > 0) {
      const dPct = engineB?.discountPercent ?? 0;
      const m = impliedTier(snap, r.country, carrierNetBase, dPct, args.reverseTolPct);
      if (m) {
        impliedTierKg = m.upperKg;
        impliedKg = m.upperKg;
      }
    }

    // 3. Per-bucket gaps (billed NET minus engine NET).
    // Engine.base is already NET (rate sheet stores post-contract
    // prices). Carrier net base = billedBase + billedDiscount.
    // Apples-to-apples comparison; the discount column is intentionally
    // not surfaced as its own gap — it folds into baseNet by design.
    const engineNetBase = engineB ? engineB.base - engineB.discount : null;
    const gap: Finding['gap'] = {
      base: engineNetBase !== null ? carrierNetBase - engineNetBase : null,
      fuel: engineB ? Number(r.billedFuel ?? 0) - engineB.fuel : null,
      remote: engineB ? Number(r.billedRemote ?? 0) - engineB.remote : null,
      demand: engineB ? Number(r.billedDemand ?? 0) - engineB.demand : null,
      vat: engineB ? Number(r.billedVat ?? 0) - engineB.vat : null,
      // The invoice doesn't break country_fixed out as a column — it
      // gets folded into base or fuel depending on the parser. Surface
      // engine-side only so the operator sees what we expected.
      countryFixed: engineB ? -engineB.countryFixed : null,
    };

    const { category, note } = classify(reported, impliedKg, gap, delta, args.matchedTol);
    counts[category]++;

    findings.push({
      tracking: r.tracking ?? '?',
      orderNumber: r.orderNumber ?? '?',
      carrier: r.carrierKey ?? '?',
      country: r.country ?? '?',
      postcode: r.postcode,
      city: r.city,
      reportedWeightKg: reported,
      actualWeightKg: actual,
      impliedWeightKg: impliedKg,
      impliedTierUpperKg: impliedTierKg,
      billedTotal,
      engineTotal,
      delta,
      gap,
      category,
      note,
    });
  }

  // Summary
  console.log('\n========== AUDIT SUMMARY ==========');
  console.log(`Processed:        ${findings.length}`);
  console.log(`Sum billed:       ${sumBilled.toLocaleString('vi-VN')} VND`);
  console.log(`Sum engine:       ${sumEngine.toLocaleString('vi-VN')} VND`);
  console.log(`Total delta:      ${(sumBilled - sumEngine).toLocaleString('vi-VN')} VND  (${((sumBilled - sumEngine) / Math.max(sumBilled, 1) * 100).toFixed(1)} %)`);
  console.log('\nBy category:');
  for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    const pct = (v / findings.length * 100).toFixed(1);
    console.log(`  ${k.padEnd(18)} ${String(v).padStart(5)}  (${pct}%)`);
  }

  // Top by abs delta, excluding MATCHED
  const interesting = findings
    .filter((f) => f.category !== 'MATCHED')
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, args.top);

  console.log(`\n========== TOP ${interesting.length} MISMATCHES ==========`);
  for (const f of interesting) {
    console.log(
      `\n[${f.category}] ${f.carrier.toUpperCase()} ${f.tracking}  ${f.orderNumber} → ${f.country}${f.postcode ? ` ${f.postcode}` : ''}${f.city ? ` (${f.city})` : ''}`,
    );
    console.log(
      `   weight: reported=${f.reportedWeightKg ?? '-'} kg, actual=${f.actualWeightKg ?? '-'} kg, impliedTier=${f.impliedTierUpperKg ?? '-'} kg`,
    );
    console.log(
      `   billed=${f.billedTotal.toLocaleString('vi-VN')} VND, engine=${(f.engineTotal ?? 0).toLocaleString('vi-VN')} VND, delta=${f.delta.toLocaleString('vi-VN')} VND`,
    );
    if (f.gap.base !== null || f.gap.fuel !== null || f.gap.remote !== null || f.gap.demand !== null) {
      const parts: string[] = [];
      for (const k of ['base', 'fuel', 'remote', 'demand', 'vat', 'countryFixed'] as const) {
        const v = f.gap[k];
        if (v !== null && Math.abs(v) > 5_000) {
          parts.push(`${k}=${v >= 0 ? '+' : ''}${v.toLocaleString('vi-VN')}`);
        }
      }
      if (parts.length > 0) console.log(`   gap: ${parts.join('  ')}`);
    }
    console.log(`   → ${f.note}`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => process.exit());
