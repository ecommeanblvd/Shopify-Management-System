'use server';

import { and, asc, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import type { ParsedPostcodeCsv } from './postcodes-csv';

export interface PostcodeRowDb {
  id: string;
  countryCode: string;
  postcodePattern: string;
  source: string | null;
  uploadedAt: Date;
}

export interface PostcodeSummary {
  totalRows: number;
  countries: { code: string; count: number }[];
  recent: PostcodeRowDb[];
}

/**
 * Stats + recent rows + per-country counts. Used by the postcode page header.
 * Avoids selecting every row — for an account with hundreds of thousands of
 * postcodes we'd otherwise blow up the response.
 */
export async function loadPostcodeSummary(
  carrierAccountId: string,
  recentLimit = 50,
): Promise<PostcodeSummary> {
  const [{ totalRows }] = await db
    .select({ totalRows: sql<number>`count(*)::int` })
    .from(schema.carrierRemotePostcodes)
    .where(eq(schema.carrierRemotePostcodes.carrierAccountId, carrierAccountId));

  const countries = await db
    .select({
      code: schema.carrierRemotePostcodes.countryCode,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.carrierRemotePostcodes)
    .where(eq(schema.carrierRemotePostcodes.carrierAccountId, carrierAccountId))
    .groupBy(schema.carrierRemotePostcodes.countryCode)
    .orderBy(sql`count(*) desc`);

  const recent = await db
    .select({
      id: schema.carrierRemotePostcodes.id,
      countryCode: schema.carrierRemotePostcodes.countryCode,
      postcodePattern: schema.carrierRemotePostcodes.postcodePattern,
      source: schema.carrierRemotePostcodes.source,
      uploadedAt: schema.carrierRemotePostcodes.uploadedAt,
    })
    .from(schema.carrierRemotePostcodes)
    .where(eq(schema.carrierRemotePostcodes.carrierAccountId, carrierAccountId))
    .orderBy(sql`uploaded_at desc`)
    .limit(recentLimit);

  return { totalRows, countries, recent };
}

/** Paged listing scoped to one country. Used on the country detail view. */
export async function listPostcodesByCountry(
  carrierAccountId: string,
  countryCode: string,
  limit = 200,
): Promise<PostcodeRowDb[]> {
  return db
    .select({
      id: schema.carrierRemotePostcodes.id,
      countryCode: schema.carrierRemotePostcodes.countryCode,
      postcodePattern: schema.carrierRemotePostcodes.postcodePattern,
      source: schema.carrierRemotePostcodes.source,
      uploadedAt: schema.carrierRemotePostcodes.uploadedAt,
    })
    .from(schema.carrierRemotePostcodes)
    .where(and(
      eq(schema.carrierRemotePostcodes.carrierAccountId, carrierAccountId),
      eq(schema.carrierRemotePostcodes.countryCode, countryCode),
    ))
    .orderBy(asc(schema.carrierRemotePostcodes.postcodePattern))
    .limit(limit);
}

const ISO2_RE = /^[A-Z]{2}$/;

export async function addPostcode({
  carrierAccountId, country, pattern, source, userId,
}: {
  carrierAccountId: string; country: string; pattern: string; source?: string; userId: string;
}): Promise<void> {
  const c = country.trim().toUpperCase();
  const p = pattern.trim();
  if (!ISO2_RE.test(c)) throw new Error('Country must be a valid ISO-2 code.');
  if (!p) throw new Error('Postcode pattern cannot be empty.');

  await db
    .insert(schema.carrierRemotePostcodes)
    .values({ carrierAccountId, countryCode: c, postcodePattern: p, source: source ?? null, uploadedBy: userId })
    .onConflictDoNothing();
}

export async function deletePostcode(id: string): Promise<void> {
  await db.delete(schema.carrierRemotePostcodes).where(eq(schema.carrierRemotePostcodes.id, id));
}

export async function deletePostcodesByCountry(
  carrierAccountId: string,
  countryCode: string,
): Promise<number> {
  const result = await db
    .delete(schema.carrierRemotePostcodes)
    .where(and(
      eq(schema.carrierRemotePostcodes.carrierAccountId, carrierAccountId),
      eq(schema.carrierRemotePostcodes.countryCode, countryCode),
    ));
  return (result as unknown as { rowCount?: number }).rowCount ?? 0;
}

/**
 * Bulk-import parsed rows. Idempotent on (account, country, pattern). Caller
 * has already validated permission. Returns the number of NEW rows inserted
 * (existing duplicates are silently skipped via ON CONFLICT DO NOTHING).
 */
export async function importPostcodes(
  carrierAccountId: string,
  parsed: ParsedPostcodeCsv,
  userId: string,
  source?: string,
): Promise<{ inserted: number; skipped: number; warnings: string[] }> {
  if (parsed.rows.length === 0) {
    return { inserted: 0, skipped: 0, warnings: parsed.warnings };
  }

  // Find which (country, pattern) pairs already exist so we can report skipped count.
  const before = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.carrierRemotePostcodes)
    .where(eq(schema.carrierRemotePostcodes.carrierAccountId, carrierAccountId));
  const beforeCount = before[0]?.count ?? 0;

  // Chunk inserts so a 50k-row upload doesn't blow the parameter limit.
  const CHUNK = 500;
  for (let i = 0; i < parsed.rows.length; i += CHUNK) {
    const slice = parsed.rows.slice(i, i + CHUNK);
    await db
      .insert(schema.carrierRemotePostcodes)
      .values(slice.map((r) => ({
        carrierAccountId,
        countryCode: r.country,
        postcodePattern: r.pattern,
        source: source ?? null,
        uploadedBy: userId,
      })))
      .onConflictDoNothing();
  }

  const after = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.carrierRemotePostcodes)
    .where(eq(schema.carrierRemotePostcodes.carrierAccountId, carrierAccountId));
  const afterCount = after[0]?.count ?? 0;

  const inserted = afterCount - beforeCount;
  const skipped = parsed.rows.length - inserted;
  return { inserted, skipped, warnings: parsed.warnings };
}
