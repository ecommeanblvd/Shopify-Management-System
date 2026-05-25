'use server';

import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { recordAudit } from '@/lib/logging/audit';
import { carrierRatesManifest } from '../manifest';
import { quote, type CarrierAccountSnapshot, type QuoteInput, type QuoteResult, type ZoneSnap } from './quote';

/**
 * Loads everything the quote engine needs in one round-trip burst:
 * account, zones, zone-country mapping, tiers, rate cells, active
 * surcharges, remote postcodes. Heavy but cached by Next.js between
 * renders of the same page.
 */
export async function loadAccountSnapshot(carrierAccountId: string): Promise<CarrierAccountSnapshot | null> {
  const [account] = await db
    .select()
    .from(schema.carrierAccounts)
    .where(eq(schema.carrierAccounts.id, carrierAccountId))
    .limit(1);
  if (!account) return null;

  const [zones, zoneCountries, tiers, surcharges, postcodes] = await Promise.all([
    db.select().from(schema.carrierZones)
      .where(eq(schema.carrierZones.carrierAccountId, carrierAccountId))
      .orderBy(asc(schema.carrierZones.position)),
    db.select().from(schema.carrierZoneCountries)
      .where(eq(schema.carrierZoneCountries.carrierAccountId, carrierAccountId)),
    db.select().from(schema.carrierWeightTiers)
      .where(eq(schema.carrierWeightTiers.carrierAccountId, carrierAccountId))
      .orderBy(asc(sql`(${schema.carrierWeightTiers.upperKg})::numeric`)),
    db.select().from(schema.carrierSurcharges)
      .where(and(
        eq(schema.carrierSurcharges.carrierAccountId, carrierAccountId),
        eq(schema.carrierSurcharges.active, true),
      )),
    db.select().from(schema.carrierRemotePostcodes)
      .where(eq(schema.carrierRemotePostcodes.carrierAccountId, carrierAccountId)),
  ]);

  // Cells loaded separately because the constraint is on zone × tier (not directly account)
  const zoneIds = zones.map((z) => z.id);
  const cells = zoneIds.length === 0
    ? []
    : await db.select().from(schema.carrierRateCells)
        .where(inArray(schema.carrierRateCells.carrierZoneId, zoneIds));

  // Index cells by (zoneId, tierId)
  const tierUpperById = new Map(tiers.map((t) => [t.id, Number(t.upperKg)]));
  const ratesByZoneId = new Map<string, Map<number, number>>();
  for (const c of cells) {
    const tierUpper = tierUpperById.get(c.carrierWeightTierId);
    if (tierUpper === undefined) continue;
    const inner = ratesByZoneId.get(c.carrierZoneId) ?? new Map<number, number>();
    inner.set(tierUpper, Number(c.costAmount));
    ratesByZoneId.set(c.carrierZoneId, inner);
  }

  // zonesByCountry: country → ZoneSnap (each zone is shared between its countries)
  const zoneSnapById = new Map<string, ZoneSnap>();
  for (const z of zones) {
    zoneSnapById.set(z.id, {
      label: z.label,
      rateByTierUpper: ratesByZoneId.get(z.id) ?? new Map(),
    });
  }
  const zonesByCountry = new Map<string, ZoneSnap>();
  for (const zc of zoneCountries) {
    const zs = zoneSnapById.get(zc.carrierZoneId);
    if (zs) zonesByCountry.set(zc.countryCode, zs);
  }

  // Remote postcodes grouped by country, carrying tier alongside each pattern
  const remotePostcodes = new Map<string, Map<string, string | null>>();
  for (const p of postcodes) {
    const inner = remotePostcodes.get(p.countryCode) ?? new Map<string, string | null>();
    inner.set(p.postcodePattern, p.tier ?? null);
    remotePostcodes.set(p.countryCode, inner);
  }

  return {
    id: account.id,
    costCurrency: account.costCurrency,
    displayCurrency: account.displayCurrency,
    fxCostPerDisplay: Number(account.fxCostPerDisplay),
    zonesByCountry,
    weightTiers: tiers.map((t) => ({ upperKg: Number(t.upperKg) })),
    surcharges: surcharges.map((s) => ({
      kind: s.kind,
      value: Number(s.value),
      active: s.active,
      tier: s.tier ?? null,
    })),
    remotePostcodes,
  };
}

/**
 * Runs a quote end-to-end against the DB. Logs the result for audit.
 * Calculator UI calls this as a server action.
 */
export async function runQuote(
  carrierAccountId: string,
  input: QuoteInput,
  userId: string,
): Promise<QuoteResult & { snapshotLoaded: boolean }> {
  const snap = await loadAccountSnapshot(carrierAccountId);
  if (!snap) {
    return {
      ok: false,
      code: 'no_zone',
      message: 'Carrier account not found.',
      snapshotLoaded: false,
    };
  }
  const result = quote(snap, input);

  // Log every calculator-context quote (sampling reserved for push_recalc later)
  try {
    await db.insert(schema.carrierQuoteLogs).values({
      carrierAccountId,
      destinationCountry: input.destinationCountry.trim().toUpperCase(),
      destinationPostcode: input.destinationPostcode?.trim() || null,
      weightKg: input.weightKg.toString(),
      breakdown: result.ok ? result.breakdown : { error: result.code, message: result.message },
      context: 'calculator',
      computedBy: userId,
    });
  } catch {
    // Logging failure shouldn't break the quote response.
  }

  // Coarse audit too — useful when investigating "why was this rate quoted"
  await recordAudit({
    userId,
    featureKey: carrierRatesManifest.key,
    action: 'carrier_quote',
    target: carrierAccountId,
    requestSummary: `${input.destinationCountry} ${input.weightKg}kg${input.destinationPostcode ? ' ' + input.destinationPostcode : ''}`,
    result: result.ok ? 'success' : 'error',
    errorDetail: result.ok ? null : result.message,
  });

  return { ...result, snapshotLoaded: true };
}
