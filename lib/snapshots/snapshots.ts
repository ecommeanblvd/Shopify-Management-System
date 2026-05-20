import { createHash } from 'node:crypto';
import { and, eq, desc } from 'drizzle-orm';
import { db, schema } from '@/db/client';

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>).sort().map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

export function hashPayload(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(sortKeys(payload))).digest('hex');
}

export function shouldInsertSnapshot(latestHash: string | null, newHash: string): boolean {
  return latestHash !== newHash;
}

/** Stores a snapshot only when the payload differs from the store+domain's latest snapshot. */
export async function captureSnapshot(args: {
  storeId: string; domain: string; payload: unknown; capturedBy: string | null;
}): Promise<{ inserted: boolean }> {
  const newHash = hashPayload(args.payload);
  const [latest] = await db.select({ payloadHash: schema.settingsSnapshots.payloadHash })
    .from(schema.settingsSnapshots)
    .where(and(eq(schema.settingsSnapshots.storeId, args.storeId), eq(schema.settingsSnapshots.domain, args.domain)))
    .orderBy(desc(schema.settingsSnapshots.capturedAt))
    .limit(1);

  if (!shouldInsertSnapshot(latest?.payloadHash ?? null, newHash)) {
    return { inserted: false };
  }
  await db.insert(schema.settingsSnapshots).values({
    storeId: args.storeId, domain: args.domain,
    payload: args.payload as object, payloadHash: newHash, capturedBy: args.capturedBy,
  });
  return { inserted: true };
}
