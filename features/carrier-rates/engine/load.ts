'use server';

import { and, asc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { recordAudit } from '@/lib/logging/audit';
import { carrierRatesManifest } from '../manifest';
import { quote, type CarrierAccountSnapshot, type QuoteInput, type QuoteResult, type ZoneSnap } from './quote';
import { pickRateCardForDate, listRateCards } from './rate-cards';

/**
 * Loads everything the quote engine needs in one round-trip burst:
 * account, zones, zone-country mapping, tiers, rate cells, active
 * surcharges, remote postcodes. Heavy but cached by Next.js between
 * renders of the same page.
 */
export async function loadAccountSnapshot(
  carrierAccountId: string,
  effectiveDate: Date = new Date(),
  opts?: {
    /** Chỉ nạp remote/ODA postcodes của 1 nước đích (ISO-2). Bảng ODA full-list
     *  2026 ~130k dòng/account — quote 1 đơn chỉ cần đúng nước của nó; bỏ trống
     *  = nạp tất cả (calculator, dựng ratecard nhiều nước). */
    remoteCountry?: string;
    /** Như remoteCountry nhưng cho NHIỀU nước (batch nhiều đơn: dashboard,
     *  đối soát). Rỗng = không lọc. Gộp cùng remoteCountry nếu truyền cả hai. */
    remoteCountries?: readonly string[];
    /** Bỏ hẳn postcode list (dựng ratecard: chỉ cần DÒNG phụ phí, không match
     *  postcode cụ thể). */
    skipRemotePostcodes?: boolean;
  },
): Promise<CarrierAccountSnapshot | null> {
  const [account] = await db
    .select()
    .from(schema.carrierAccounts)
    .where(eq(schema.carrierAccounts.id, carrierAccountId))
    .limit(1);
  if (!account) return null;

  // Pick the base-rate card whose window covers effectiveDate. No card →
  // no base rates for that date; return null so callers surface it clearly.
  const cards = await listRateCards(carrierAccountId);
  const card = pickRateCardForDate(cards, effectiveDate);
  if (!card) return null;

  // date columns compare as 'YYYY-MM-DD' strings; normalise effectiveDate once.
  const remoteAsOf = effectiveDate.toISOString().slice(0, 10);

  const [zones, zoneCountries, zonePostcodeRangeRows, tiers, surcharges, postcodes] = await Promise.all([
    db.select().from(schema.carrierZones)
      .where(eq(schema.carrierZones.carrierAccountId, carrierAccountId))
      .orderBy(asc(schema.carrierZones.position)),
    db.select().from(schema.carrierZoneCountries)
      .where(eq(schema.carrierZoneCountries.carrierAccountId, carrierAccountId)),
    // Zone theo dải bưu chính (CN Hoa Nam → Zone K) — bảng nhỏ, không gating date.
    db.select().from(schema.carrierZonePostcodeRanges)
      .where(eq(schema.carrierZonePostcodeRanges.carrierAccountId, carrierAccountId)),
    db.select().from(schema.carrierWeightTiers)
      .where(eq(schema.carrierWeightTiers.carrierAccountId, carrierAccountId))
      .orderBy(asc(sql`(${schema.carrierWeightTiers.upperKg})::numeric`)),
    db.select().from(schema.carrierSurcharges)
      .where(and(
        eq(schema.carrierSurcharges.carrierAccountId, carrierAccountId),
        eq(schema.carrierSurcharges.active, true),
      )),
    // Remote/ODA list is year-versioned (effective_from/to), applied by the
    // shipment's effectiveDate — same windowing as rate cards. A row covers the
    // date when effective_from ≤ date AND (effective_to IS NULL OR date < effective_to).
    opts?.skipRemotePostcodes
      ? Promise.resolve([] as (typeof schema.carrierRemotePostcodes.$inferSelect)[])
      : db.select().from(schema.carrierRemotePostcodes)
        .where(and(
          eq(schema.carrierRemotePostcodes.carrierAccountId, carrierAccountId),
          ...(() => {
            // Gộp remoteCountry + remoteCountries → 1 điều kiện IN. Bảng ODA
            // ~1tr dòng/2 account: nạp full tốn ~118MB EGRESS mỗi lần gọi
            // (Supabase tính tiền theo egress — 24/08 vượt quota 83GB/5GB).
            const list = [
              ...(opts?.remoteCountry ? [opts.remoteCountry] : []),
              ...(opts?.remoteCountries ?? []),
            ].map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c));
            const uniq = [...new Set(list)];
            return uniq.length ? [inArray(schema.carrierRemotePostcodes.countryCode, uniq)] : [];
          })(),
          lte(schema.carrierRemotePostcodes.effectiveFrom, remoteAsOf),
          or(
            isNull(schema.carrierRemotePostcodes.effectiveTo),
            gt(schema.carrierRemotePostcodes.effectiveTo, remoteAsOf),
          ),
        )),
  ]);

  // Cells scoped to the chosen rate card (NOT all cells for the account).
  const cells = await db.select().from(schema.carrierRateCells)
    .where(eq(schema.carrierRateCells.rateCardId, card.id));

  // Index cells by (zoneId, tierId) — split by package_type so the engine
  // can pick Pak vs Package per the < 2kg rule.
  const tierUpperById = new Map(tiers.map((t) => [t.id, Number(t.upperKg)]));
  const packageRatesByZoneId = new Map<string, Map<number, number>>();
  const pakRatesByZoneId = new Map<string, Map<number, number>>();
  for (const c of cells) {
    const tierUpper = tierUpperById.get(c.carrierWeightTierId);
    if (tierUpper === undefined) continue;
    const bucket = c.packageType === 'pak' ? pakRatesByZoneId : packageRatesByZoneId;
    const inner = bucket.get(c.carrierZoneId) ?? new Map<number, number>();
    inner.set(tierUpper, Number(c.costAmount));
    bucket.set(c.carrierZoneId, inner);
  }

  // zonesByCountry: country → ZoneSnap (each zone is shared between its countries)
  const zoneSnapById = new Map<string, ZoneSnap>();
  for (const z of zones) {
    zoneSnapById.set(z.id, {
      label: z.label,
      rateByTierUpper: packageRatesByZoneId.get(z.id) ?? new Map(),
      pakRateByTierUpper: pakRatesByZoneId.get(z.id) ?? new Map(),
    });
  }
  const zonesByCountry = new Map<string, ZoneSnap>();
  for (const zc of zoneCountries) {
    const zs = zoneSnapById.get(zc.carrierZoneId);
    if (zs) zonesByCountry.set(zc.countryCode, zs);
  }

  // Zone override theo dải bưu chính (engine match trước zonesByCountry).
  const zonePostcodeRanges = zonePostcodeRangeRows.flatMap((r) => {
    const zs = zoneSnapById.get(r.carrierZoneId);
    return zs ? [{ countryCode: r.countryCode.toUpperCase(), rangeStart: r.rangeStart, rangeEnd: r.rangeEnd, zone: zs }] : [];
  });

  // Remote postcodes grouped by country, carrying tier alongside each pattern
  const remotePostcodes = new Map<string, Map<string, string | null>>();
  for (const p of postcodes) {
    const inner = remotePostcodes.get(p.countryCode) ?? new Map<string, string | null>();
    inner.set(p.postcodePattern, p.tier ?? null);
    // Also index the alphanumeric-stripped form so hyphen/space format
    // differences between the carrier file and Shopify input can't
    // break the O(1) match ('5000-289' ↔ '5000289'). '*' wildcard and
    // already-clean keys collapse to themselves.
    const stripped = p.postcodePattern.toUpperCase().replace(/[^A-Z0-9*]/g, '');
    if (stripped && !inner.has(stripped)) inner.set(stripped, p.tier ?? null);
    remotePostcodes.set(p.countryCode, inner);
  }

  return {
    id: account.id,
    name: account.name,
    costCurrency: account.costCurrency,
    displayCurrency: account.displayCurrency,
    fxCostPerDisplay: Number(account.fxCostPerDisplay),
    // NULL → skip dim-weight entirely (engine charges actual). Default
    // 5000 cm³/kg (FedEx/DHL Air standard) set at the column level.
    dimDivisorCm3PerKg: account.dimDivisorCm3PerKg !== null
      ? Number(account.dimDivisorCm3PerKg)
      : null,
    chargeableRoundingMode: (account.chargeableRoundingMode === 'ceil' ? 'ceil' : null),
    totalsRoundingMode: (account.totalsRoundingMode === 'per_line' ? 'per_line' : null),
    chargeableRoundingKg: account.chargeableRoundingKg !== null
      ? Number(account.chargeableRoundingKg)
      : null,
    zonesByCountry,
    zonePostcodeRanges,
    weightTiers: tiers.map((t) => ({ upperKg: Number(t.upperKg) })),
    surcharges: surcharges.map((s) => ({
      kind: s.kind,
      value: Number(s.value),
      valuePerKg: s.valuePerKg !== null ? Number(s.valuePerKg) : null,
      active: s.active,
      tier: s.tier ?? null,
      // `country_codes` is jsonb — already deserialised by node-postgres
      // when present. Normalise to upper-case ISO-2 so the engine's
      // `country` lookup (which also upper-cases) hits.
      countryCodes: Array.isArray(s.countryCodes)
        ? (s.countryCodes as string[]).map((c) => c.toUpperCase())
        : null,
      excludedCountryCodes: Array.isArray(s.excludedCountryCodes)
        ? (s.excludedCountryCodes as string[]).map((c) => c.toUpperCase())
        : null,
      stepKg: s.stepKg !== null ? Number(s.stepKg) : null,
      stepFloorKg: s.stepFloorKg !== null ? Number(s.stepFloorKg) : null,
      fuelable: s.fuelable,
      vatable: s.vatable,
      applyMode: (s.applyMode === 'when_billed' ? 'when_billed' : 'always') as 'always' | 'when_billed',
      // Engine gates each row by (startsAt, endsAt) against the caller's
      // effectiveDate inside `quote()`. Loader still filters `active=true`
      // at SQL level to keep the working set small; rows whose window
      // doesn't cover the quote date are excluded in JS.
      startsAt: s.startsAt,
      endsAt: s.endsAt,
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
