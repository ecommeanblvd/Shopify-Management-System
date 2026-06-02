/**
 * HTTP endpoint that refreshes the FedEx fuel-surcharge percentage for every
 * enabled FedEx carrier account.
 *
 * Primary cron path on Railway uses the standalone script at
 * `scripts/cron/refresh-fedex-fuel.ts` (run via `npm run cron:refresh-fuel`
 * on a separate Railway cron service that shares DATABASE_URL with the
 * main app). This HTTP route is kept for two cases:
 *
 *   1. External cron providers that prefer HTTPS pings over running a
 *      Node process (cron-job.org, EasyCron, GitHub Actions schedule).
 *   2. Manual force-refresh from outside the UI ("just hit the URL with
 *      curl + the bearer token").
 *
 * Authentication
 * --------------
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *        https://<your-railway-url>/api/cron/refresh-fuel
 *
 * Response shape
 * --------------
 *   { ok: true, ran: number, results: [{ accountId, accountName, previousPercent,
 *                                         newPercent, changed }, ...] }
 *   { ok: false, error: string }                  // 401/500
 */

import { NextResponse } from 'next/server';
import { eq, and, inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { refreshCarrierFuel } from '@/features/carrier-rates/fuel-fetcher/apply';

// Don't pre-render or cache.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface PerAccountResult {
  accountId: string;
  accountName: string;
  carrierKey: string;
  previousPercent: number | null;
  newPercent: number | null;
  changed: boolean;
  error?: string;
}

export async function GET(request: Request): Promise<Response> {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: 'CRON_SECRET is not configured on this deployment.' },
      { status: 500 },
    );
  }
  const authHeader = request.headers.get('authorization') ?? '';
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  // Every enabled account whose carrier has an auto-fetcher (FedEx + DHL).
  // The dispatcher (refreshCarrierFuel) throws on carriers without a
  // fetcher, so we keep this filter narrow up-front to avoid noise in
  // the result.
  const accounts = await db
    .select({
      id: schema.carrierAccounts.id,
      name: schema.carrierAccounts.name,
      carrierKey: schema.carriers.key,
    })
    .from(schema.carrierAccounts)
    .leftJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId))
    .where(
      and(
        inArray(schema.carriers.key, ['fedex', 'dhl']),
        eq(schema.carrierAccounts.enabled, true),
      ),
    );

  const results: PerAccountResult[] = [];
  for (const account of accounts) {
    try {
      const applied = await refreshCarrierFuel({
        carrierAccountId: account.id,
        triggeredBy: null, // Cron isn't a user — leave updatedBy untouched.
      });
      results.push({
        accountId: account.id,
        accountName: account.name,
        carrierKey: applied.carrierKey,
        previousPercent: applied.previousPercent,
        newPercent: applied.newPercent,
        changed: applied.changed,
      });
    } catch (err) {
      // One account failure shouldn't stop the rest of the batch — keep
      // going and surface the error in the response so we can debug.
      results.push({
        accountId: account.id,
        accountName: account.name,
        carrierKey: account.carrierKey ?? 'unknown',
        previousPercent: null,
        newPercent: null,
        changed: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({ ok: true, ran: results.length, results });
}
