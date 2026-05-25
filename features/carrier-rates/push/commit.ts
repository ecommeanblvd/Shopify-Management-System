'use server';

import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { recordAudit } from '@/lib/logging/audit';
import { loadAccountSnapshot } from '../engine/load';
import { recalcMarket, type CarrierServiceForRecalc, type RecalcRateBreakdown } from './recalc';
import { carrierRatesManifest } from '../manifest';
import type { MarketShipping } from '@/features/markets/types';

export interface PushPlanRow {
  marketHandle: string;
  marketName: string;
  storeId: string;
  storeName: string;
  /** Rate name → new price (display currency). NaN for failed quotes. */
  rates: { name: string; price: number; warning: string | null }[];
  /** Existing rate names already stored on market_store_overrides.shipping. */
  currentRateNames: string[];
}

export interface PushPlan {
  carrierAccountId: string;
  rows: PushPlanRow[];
  /** Detailed breakdown per (market, store, rate) for debugging / audit. */
  breakdown: (RecalcRateBreakdown & { marketHandle: string; storeId: string })[];
  /** Top-level warnings — e.g. no linked stores. */
  warnings: string[];
}

/**
 * Build a preview plan for the operator to confirm before commit.
 * Loads everything in one pass:
 *   - account snapshot (zones, tiers, rates, surcharges, postcodes)
 *   - market_carrier_links for this account (which markets to push)
 *   - market_templates for the linked market handles
 *   - all stores + their existing market_store_overrides for those markets
 *
 * For each (market, store) we recalc using the engine and compare against the
 * current shipping zone, if any.
 */
export async function buildPushPlan(carrierAccountId: string): Promise<PushPlan> {
  const warnings: string[] = [];
  const snap = await loadAccountSnapshot(carrierAccountId);
  if (!snap) {
    return { carrierAccountId, rows: [], breakdown: [], warnings: ['Carrier account not found.'] };
  }

  const links = await db
    .select({
      id: schema.marketCarrierLinks.id,
      marketHandle: schema.marketCarrierLinks.marketHandle,
      serviceLabel: schema.marketCarrierLinks.serviceLabel,
      enabled: schema.marketCarrierLinks.enabled,
    })
    .from(schema.marketCarrierLinks)
    .where(and(
      eq(schema.marketCarrierLinks.carrierAccountId, carrierAccountId),
      eq(schema.marketCarrierLinks.enabled, true),
    ));

  if (links.length === 0) {
    return {
      carrierAccountId,
      rows: [],
      breakdown: [],
      warnings: ['No enabled market links. Open a market and link this account first.'],
    };
  }

  const handles = links.map((l) => l.marketHandle);
  const markets = await db
    .select()
    .from(schema.marketTemplates)
    .where(inArray(schema.marketTemplates.handle, handles));
  const marketByHandle = new Map(markets.map((m) => [m.handle, m]));

  const stores = await db.select().from(schema.stores).where(eq(schema.stores.status, 'active'));
  if (stores.length === 0) {
    warnings.push('No active stores connected. Nothing to push.');
  }

  const overrides = await db
    .select()
    .from(schema.marketStoreOverrides)
    .where(inArray(schema.marketStoreOverrides.marketHandle, handles));
  const overrideByKey = new Map(
    overrides.map((o) => [`${o.storeId}::${o.marketHandle}`, o] as const),
  );

  const rows: PushPlanRow[] = [];
  const allBreakdown: (RecalcRateBreakdown & { marketHandle: string; storeId: string })[] = [];

  for (const link of links) {
    const market = marketByHandle.get(link.marketHandle);
    if (!market) {
      warnings.push(`Linked market "${link.marketHandle}" no longer exists.`);
      continue;
    }
    const services: CarrierServiceForRecalc[] = [
      { carrierAccountId, serviceLabel: link.serviceLabel, snapshot: snap },
    ];
    const recalc = recalcMarket({
      marketHandle: market.handle,
      countries: market.countries as string[],
      primaryCurrency: market.primaryCurrency,
      services,
    });

    for (const store of stores) {
      const existing = overrideByKey.get(`${store.id}::${market.handle}`);
      const existingZone = (existing?.shipping as MarketShipping | null | undefined)?.zones?.[market.handle];
      const currentRateNames = existingZone ? Object.keys(existingZone.rates) : [];

      rows.push({
        marketHandle: market.handle,
        marketName: market.name,
        storeId: store.id,
        storeName: store.name,
        rates: recalc.breakdown.map((b) => ({
          name: b.rateName,
          price: b.finalDisplay,
          warning: b.warning,
        })),
        currentRateNames,
      });

      for (const b of recalc.breakdown) {
        allBreakdown.push({ ...b, marketHandle: market.handle, storeId: store.id });
      }
    }
  }

  return { carrierAccountId, rows, breakdown: allBreakdown, warnings };
}

export interface CommitPlanResult {
  marketsWritten: number;
  storesAffected: number;
  ratesEmitted: number;
  warnings: string[];
}

/**
 * Persist the recalc into market_store_overrides.shipping for every
 * (market × store) the operator is pushing.
 *
 * Replaces the carrier-managed zone for each market on each store; preserves
 * priceAdjustment and any other zones the user may have authored manually.
 */
export async function commitPushPlan(
  carrierAccountId: string,
  userId: string,
): Promise<CommitPlanResult> {
  const plan = await buildPushPlan(carrierAccountId);
  if (plan.rows.length === 0) {
    return { marketsWritten: 0, storesAffected: 0, ratesEmitted: 0, warnings: plan.warnings };
  }

  // Re-resolve recalc per (market, store) — same call shape used during preview.
  const snap = await loadAccountSnapshot(carrierAccountId);
  if (!snap) {
    return { marketsWritten: 0, storesAffected: 0, ratesEmitted: 0, warnings: ['Account vanished mid-commit.'] };
  }

  const distinctMarkets = new Set<string>();
  const distinctStores = new Set<string>();
  let totalRates = 0;

  for (const row of plan.rows) {
    const marketRow = await db
      .select()
      .from(schema.marketTemplates)
      .where(eq(schema.marketTemplates.handle, row.marketHandle))
      .limit(1);
    if (marketRow.length === 0) continue;
    const market = marketRow[0];

    const linksForMarket = await db
      .select()
      .from(schema.marketCarrierLinks)
      .where(and(
        eq(schema.marketCarrierLinks.marketHandle, market.handle),
        eq(schema.marketCarrierLinks.carrierAccountId, carrierAccountId),
        eq(schema.marketCarrierLinks.enabled, true),
      ));
    if (linksForMarket.length === 0) continue;

    const recalc = recalcMarket({
      marketHandle: market.handle,
      countries: market.countries as string[],
      primaryCurrency: market.primaryCurrency,
      services: linksForMarket.map((l) => ({
        carrierAccountId,
        serviceLabel: l.serviceLabel,
        snapshot: snap,
      })),
    });

    // Merge into existing shipping (preserve other zones)
    const existing = await db
      .select()
      .from(schema.marketStoreOverrides)
      .where(and(
        eq(schema.marketStoreOverrides.storeId, row.storeId),
        eq(schema.marketStoreOverrides.marketHandle, market.handle),
      ))
      .limit(1);

    const existingShipping = (existing[0]?.shipping as MarketShipping | null | undefined) ?? null;
    const mergedShipping: MarketShipping = {
      zones: {
        ...(existingShipping?.zones ?? {}),
        // Recalc currently emits exactly one zone keyed by market.handle.
        ...recalc.shipping.zones,
      },
    };
    const ratesInThisCommit = Object.keys(recalc.shipping.zones[market.handle]?.rates ?? {}).length;
    totalRates += ratesInThisCommit;

    if (existing.length === 0) {
      await db.insert(schema.marketStoreOverrides).values({
        storeId: row.storeId,
        marketHandle: market.handle,
        priceAdjustment: null,
        shipping: mergedShipping,
        updatedBy: userId,
      });
    } else {
      await db
        .update(schema.marketStoreOverrides)
        .set({ shipping: mergedShipping, updatedBy: userId, updatedAt: new Date() })
        .where(and(
          eq(schema.marketStoreOverrides.storeId, row.storeId),
          eq(schema.marketStoreOverrides.marketHandle, market.handle),
        ));
    }

    distinctMarkets.add(market.handle);
    distinctStores.add(row.storeId);
  }

  await recordAudit({
    userId,
    featureKey: carrierRatesManifest.key,
    action: 'carrier_rates_push',
    target: carrierAccountId,
    requestSummary: `markets=${distinctMarkets.size} stores=${distinctStores.size} rates=${totalRates}`,
    result: 'success',
  });

  return {
    marketsWritten: distinctMarkets.size,
    storesAffected: distinctStores.size,
    ratesEmitted: totalRates,
    warnings: plan.warnings,
  };
}
