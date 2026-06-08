import { asc, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';

/** Minimal window shape the picker needs. Dates compared at day granularity. */
export interface RateCardWindow {
  id: string;
  effectiveFrom: Date;
  /** null = open-ended (current) card. */
  effectiveTo: Date | null;
}

/**
 * Pick the rate card whose [effectiveFrom, effectiveTo] covers `date`.
 * Both bounds are INCLUSIVE. effectiveTo === null means open-ended.
 * Returns null when no card covers the date (caller emits a clear reason).
 *
 * Compares on calendar day (UTC date portion) so a ship timestamp at any
 * hour on the cutover day still lands in the right card.
 */
export function pickRateCardForDate(
  cards: RateCardWindow[],
  date: Date,
): RateCardWindow | null {
  const day = toDayNumber(date);
  for (const c of cards) {
    const from = toDayNumber(c.effectiveFrom);
    const to = c.effectiveTo === null ? Infinity : toDayNumber(c.effectiveTo);
    if (day >= from && day <= to) return c;
  }
  return null;
}

function toDayNumber(d: Date): number {
  // Days since epoch in UTC — drops the time-of-day so inclusive day-bounds
  // behave predictably regardless of timezone.
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86_400_000);
}

/** All rate cards for an account, ordered oldest-first. `date` columns come
 *  back from node-postgres as strings ('YYYY-MM-DD'); normalise to Date at
 *  the day-granularity the picker needs. */
export async function listRateCards(carrierAccountId: string): Promise<RateCardWindow[]> {
  const rows = await db
    .select({
      id: schema.carrierRateCards.id,
      effectiveFrom: schema.carrierRateCards.effectiveFrom,
      effectiveTo: schema.carrierRateCards.effectiveTo,
    })
    .from(schema.carrierRateCards)
    .where(eq(schema.carrierRateCards.carrierAccountId, carrierAccountId))
    .orderBy(asc(schema.carrierRateCards.effectiveFrom));
  return rows.map((r) => ({
    id: r.id,
    effectiveFrom: new Date(r.effectiveFrom),
    effectiveTo: r.effectiveTo ? new Date(r.effectiveTo) : null,
  }));
}
