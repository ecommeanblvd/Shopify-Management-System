import { db, schema } from '@/db/client';

export interface AccessEntry {
  userId: string | null;
  storeId: string | null;
  featureKey: string;
}

export function buildAccessEntry(input: AccessEntry): AccessEntry {
  return { userId: input.userId, storeId: input.storeId, featureKey: input.featureKey };
}

/** One record per feature-entry (user opens a feature for a store). Not per API call. */
export async function recordAccess(input: AccessEntry): Promise<void> {
  await db.insert(schema.accessLog).values(buildAccessEntry(input));
}
