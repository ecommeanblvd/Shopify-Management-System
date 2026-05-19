import { eq, and } from 'drizzle-orm';
import { db, schema } from '@/db/client';

export interface FlagRow {
  featureKey: string;
  storeId: string;
  enabled: boolean;
}

export type FlagLookup = (featureKey: string, storeId: string) => Promise<FlagRow | null>;

const dbLookup: FlagLookup = async (featureKey, storeId) => {
  const [row] = await db
    .select()
    .from(schema.featureFlags)
    .where(and(eq(schema.featureFlags.featureKey, featureKey), eq(schema.featureFlags.storeId, storeId)))
    .limit(1);
  return row ? { featureKey, storeId, enabled: row.enabled } : null;
};

/** Features are default-off: a missing flag row means disabled. */
export async function isFeatureEnabled(
  featureKey: string,
  storeId: string,
  lookup: FlagLookup = dbLookup,
): Promise<boolean> {
  const row = await lookup(featureKey, storeId);
  return row?.enabled ?? false;
}
