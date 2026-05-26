/**
 * Weekly cron: refresh the FedEx fuel-surcharge percentage for every
 * enabled FedEx carrier account.
 *
 * Authentication
 * --------------
 * Vercel Cron automatically attaches `Authorization: Bearer ${CRON_SECRET}`
 * to scheduled invocations when the env var is set on the project. We require
 * a match here, which also keeps random internet traffic from triggering DB
 * writes.
 *
 * Local testing
 * -------------
 *   CRON_SECRET=dev node -e "fetch('http://localhost:3000/api/cron/refresh-fuel',
 *     { headers: { Authorization: 'Bearer dev' } }).then(r => r.json()).then(console.log)"
 *
 * Response shape
 * --------------
 *   { ok: true, ran: number, results: [{ accountId, accountName, previousPercent,
 *                                         newPercent, changed }, ...] }
 *   { ok: false, error: string }                  // 401/500
 */

import { NextResponse } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { refreshFedExFuel } from '@/features/carrier-rates/fuel-fetcher/apply';

// Don't pre-render or cache.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// FedEx page + JSON service may take a couple of seconds; raise the ceiling.
export const maxDuration = 60;

interface PerAccountResult {
  accountId: string;
  accountName: string;
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

  // All enabled FedEx accounts.
  const accounts = await db
    .select({
      id: schema.carrierAccounts.id,
      name: schema.carrierAccounts.name,
    })
    .from(schema.carrierAccounts)
    .leftJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId))
    .where(
      and(
        eq(schema.carriers.key, 'fedex'),
        eq(schema.carrierAccounts.enabled, true),
      ),
    );

  const results: PerAccountResult[] = [];
  for (const account of accounts) {
    try {
      const applied = await refreshFedExFuel({
        carrierAccountId: account.id,
        triggeredBy: null, // Cron isn't a user — leave updatedBy untouched.
      });
      results.push({
        accountId: account.id,
        accountName: account.name,
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
        previousPercent: null,
        newPercent: null,
        changed: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({ ok: true, ran: results.length, results });
}
