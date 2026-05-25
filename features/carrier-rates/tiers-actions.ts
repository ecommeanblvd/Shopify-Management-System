'use server';

import { and, asc, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';

export interface WeightTierRow {
  id: string;
  upperKg: string;
  position: number;
}

export async function listWeightTiers(carrierAccountId: string): Promise<WeightTierRow[]> {
  const rows = await db
    .select({
      id: schema.carrierWeightTiers.id,
      upperKg: schema.carrierWeightTiers.upperKg,
      position: schema.carrierWeightTiers.position,
    })
    .from(schema.carrierWeightTiers)
    .where(eq(schema.carrierWeightTiers.carrierAccountId, carrierAccountId))
    .orderBy(asc(sql`(${schema.carrierWeightTiers.upperKg})::numeric`));
  return rows;
}

function parseUpperKg(input: string): number {
  const n = Number(input);
  if (!Number.isFinite(n) || n <= 0) throw new Error('Upper kg must be a positive number.');
  if (n > 1000) throw new Error('Upper kg must be at most 1000.');
  // 3 decimal places max
  const rounded = Math.round(n * 1000) / 1000;
  return rounded;
}

export async function createWeightTier(carrierAccountId: string, upperKgRaw: string): Promise<string> {
  const upperKg = parseUpperKg(upperKgRaw);

  // Avoid duplicates at the numeric level. The unique constraint also enforces this.
  const existing = await db
    .select()
    .from(schema.carrierWeightTiers)
    .where(and(
      eq(schema.carrierWeightTiers.carrierAccountId, carrierAccountId),
      sql`(${schema.carrierWeightTiers.upperKg})::numeric = ${upperKg}::numeric`,
    ))
    .limit(1);
  if (existing.length > 0) throw new Error(`Tier ${upperKg} kg already exists.`);

  const [{ next }] = await db
    .select({ next: sql<number>`coalesce(max(${schema.carrierWeightTiers.position}), -1) + 1` })
    .from(schema.carrierWeightTiers)
    .where(eq(schema.carrierWeightTiers.carrierAccountId, carrierAccountId));

  const [row] = await db
    .insert(schema.carrierWeightTiers)
    .values({ carrierAccountId, upperKg: upperKg.toString(), position: next })
    .returning({ id: schema.carrierWeightTiers.id });
  return row!.id;
}

export async function deleteWeightTier(tierId: string): Promise<void> {
  // ON DELETE CASCADE removes related rate_cells.
  await db.delete(schema.carrierWeightTiers).where(eq(schema.carrierWeightTiers.id, tierId));
}

/**
 * Convenience seed: appends a sensible default ladder to an account that has
 * no tiers yet. Idempotent if called twice (skips existing).
 */
export async function seedDefaultTiers(carrierAccountId: string): Promise<number> {
  const existing = await db
    .select()
    .from(schema.carrierWeightTiers)
    .where(eq(schema.carrierWeightTiers.carrierAccountId, carrierAccountId))
    .limit(1);
  if (existing.length > 0) return 0;

  const defaults = [0.5, 1, 1.5, 2, 2.5, 3, 5, 10, 20, 30, 50, 70, 100];
  await db.insert(schema.carrierWeightTiers).values(
    defaults.map((upperKg, i) => ({
      carrierAccountId,
      upperKg: upperKg.toString(),
      position: i,
    })),
  );
  return defaults.length;
}
