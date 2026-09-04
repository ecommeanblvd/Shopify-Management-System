/**
 * HTTP endpoint that checks the FedEx Vietnam Demand-Surcharge page for NEW
 * periods (whose effectiveFrom isn't already a startsAt in the FedEx
 * demand_per_kg config) and records an audit alert per new period.
 *
 * It does NOT auto-apply config — applying stays a deliberate, reviewed step.
 *
 * Primary cron path on Railway uses the standalone script at
 * `scripts/cron/refresh-fedex-demand.ts` (run via `npm run cron:refresh-demand`
 * on a separate Railway cron service that shares DATABASE_URL with the main
 * app). This HTTP route is kept for external cron providers that prefer HTTPS
 * pings, and for manual force-checks.
 *
 * Authentication
 * --------------
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *        https://<your-railway-url>/api/cron/refresh-demand
 *
 * Response shape
 * --------------
 *   { ok: true, checkedAt, newPeriods: [...], parseErrors: [...] }
 *   { ok: false, error: string }                  // 401/500
 */

import { NextResponse } from 'next/server';
import { checkFedExDemandUpdates } from '@/features/carrier-rates/demand-fetcher/alert';

import { chayJobApi } from '@/features/jobs/api-run';
// Don't pre-render or cache.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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

  try {
    const result = await chayJobApi('refresh-demand', () => checkFedExDemandUpdates());
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
