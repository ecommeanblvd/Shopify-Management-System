'use server';

import { and, asc, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import type { ParsedPostcodeCsv } from './postcodes-csv';

export interface PostcodeRowDb {
  id: string;
  countryCode: string;
  postcodePattern: string;
  tier: string | null;
  source: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  uploadedAt: Date;
}

const POSTCODE_COLS = {
  id: schema.carrierRemotePostcodes.id,
  countryCode: schema.carrierRemotePostcodes.countryCode,
  postcodePattern: schema.carrierRemotePostcodes.postcodePattern,
  tier: schema.carrierRemotePostcodes.tier,
  source: schema.carrierRemotePostcodes.source,
  effectiveFrom: schema.carrierRemotePostcodes.effectiveFrom,
  effectiveTo: schema.carrierRemotePostcodes.effectiveTo,
  uploadedAt: schema.carrierRemotePostcodes.uploadedAt,
} as const;

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
    .select(POSTCODE_COLS)
    .from(schema.carrierRemotePostcodes)
    .where(eq(schema.carrierRemotePostcodes.carrierAccountId, carrierAccountId))
    .orderBy(sql`uploaded_at desc`)
    .limit(recentLimit);

  return { totalRows, countries, recent };
}

/** Paged listing scoped to one country (optionally one period). Country detail view. */
export async function listPostcodesByCountry(
  carrierAccountId: string,
  countryCode: string,
  opts: { period?: string | null; limit?: number } = {},
): Promise<PostcodeRowDb[]> {
  const limit = opts.limit ?? 200;
  return db
    .select(POSTCODE_COLS)
    .from(schema.carrierRemotePostcodes)
    .where(and(
      eq(schema.carrierRemotePostcodes.carrierAccountId, carrierAccountId),
      eq(schema.carrierRemotePostcodes.countryCode, countryCode),
      ...(opts.period ? [eq(schema.carrierRemotePostcodes.effectiveFrom, opts.period)] : []),
    ))
    .orderBy(asc(schema.carrierRemotePostcodes.postcodePattern))
    .limit(limit);
}

export interface RemotePeriod {
  effectiveFrom: string | null;
  effectiveTo: string | null;
  count: number;
  sources: string[];
}

/** Distinct effective windows present for this account — drives the period filter. */
export async function listRemotePeriods(carrierAccountId: string): Promise<RemotePeriod[]> {
  const rows = await db
    .select({
      effectiveFrom: schema.carrierRemotePostcodes.effectiveFrom,
      effectiveTo: schema.carrierRemotePostcodes.effectiveTo,
      count: sql<number>`count(*)::int`,
      sources: sql<string[]>`array_agg(distinct ${schema.carrierRemotePostcodes.source})`,
    })
    .from(schema.carrierRemotePostcodes)
    .where(eq(schema.carrierRemotePostcodes.carrierAccountId, carrierAccountId))
    .groupBy(schema.carrierRemotePostcodes.effectiveFrom, schema.carrierRemotePostcodes.effectiveTo)
    .orderBy(asc(schema.carrierRemotePostcodes.effectiveFrom));
  return rows.map((r) => ({
    effectiveFrom: r.effectiveFrom,
    effectiveTo: r.effectiveTo,
    count: r.count,
    sources: (r.sources ?? []).filter(Boolean),
  }));
}

export interface PostcodeSearchResult {
  rows: PostcodeRowDb[];
  total: number;
  truncated: boolean;
}

/**
 * Free-text lookup across ALL countries by postcode OR town OR tier. The query
 * is matched both raw and alphanumeric-normalised (towns/postcodes are stored
 * normalised — "Buraydah"→BURAYDAH, "150-0012"→1500012), so a human-typed value
 * with spaces/hyphens/casing still lands. Optional country/period narrowing.
 */
export async function searchPostcodes(
  carrierAccountId: string,
  query: string,
  opts: { country?: string | null; period?: string | null; limit?: number } = {},
): Promise<PostcodeSearchResult> {
  const q = query.trim();
  if (!q) return { rows: [], total: 0, truncated: false };
  const limit = opts.limit ?? 300;
  const norm = q.toUpperCase().replace(/[^A-Z0-9]/g, '');

  const filters = [
    eq(schema.carrierRemotePostcodes.carrierAccountId, carrierAccountId),
    opts.country ? eq(schema.carrierRemotePostcodes.countryCode, opts.country.toUpperCase()) : undefined,
    opts.period ? eq(schema.carrierRemotePostcodes.effectiveFrom, opts.period) : undefined,
    // pattern contains the normalised term, OR tier matches, OR country code matches
    sql`(${schema.carrierRemotePostcodes.postcodePattern} ILIKE ${'%' + norm + '%'}
         OR ${schema.carrierRemotePostcodes.postcodePattern} ILIKE ${'%' + q.toUpperCase() + '%'}
         OR ${schema.carrierRemotePostcodes.tier} ILIKE ${'%' + q + '%'})`,
  ].filter(Boolean);

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.carrierRemotePostcodes)
    .where(and(...(filters as Parameters<typeof and>)));

  const rows = await db
    .select(POSTCODE_COLS)
    .from(schema.carrierRemotePostcodes)
    .where(and(...(filters as Parameters<typeof and>)))
    .orderBy(asc(schema.carrierRemotePostcodes.countryCode), asc(schema.carrierRemotePostcodes.postcodePattern))
    .limit(limit);

  return { rows, total, truncated: total > rows.length };
}

export interface RemoteEvidenceRow {
  id: string;
  label: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  filename: string;
  byteSize: number | null;
  uploadedAt: Date;
}

/** Source-file evidence attached to this account's remote lists. */
export async function listRemoteEvidence(carrierAccountId: string): Promise<RemoteEvidenceRow[]> {
  return db
    .select({
      id: schema.carrierRemoteEvidence.id,
      label: schema.carrierRemoteEvidence.label,
      effectiveFrom: schema.carrierRemoteEvidence.effectiveFrom,
      effectiveTo: schema.carrierRemoteEvidence.effectiveTo,
      filename: schema.carrierRemoteEvidence.filename,
      byteSize: schema.carrierRemoteEvidence.byteSize,
      uploadedAt: schema.carrierRemoteEvidence.uploadedAt,
    })
    .from(schema.carrierRemoteEvidence)
    .where(eq(schema.carrierRemoteEvidence.carrierAccountId, carrierAccountId))
    .orderBy(asc(schema.carrierRemoteEvidence.effectiveFrom), asc(schema.carrierRemoteEvidence.label));
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
