/**
 * Standalone Railway-friendly cron entry point.
 * Usage: `npm run cron:refresh-fuel`
 *
 * Iterates every enabled carrier account whose carrier key has an
 * auto-fetcher (currently 'fedex', 'dhl', 'ups' and 'sf-express') and
 * refreshes its fuel_percent surcharge. Writes audit columns (last_auto_fetched_at,
 * last_auto_source).
 *
 * Why a script instead of HTTP-pinging the API route?
 * - On Railway we typically wire a "Cron" service that shares the DATABASE_URL
 *   of the main service. The cron service just runs this script, hitting the
 *   DB directly — no HTTP layer, no Bearer-token dance.
 * - The `/api/cron/refresh-fuel` API route is still present for external
 *   cron services (cron-job.org, EasyCron) that want to fire over HTTPS.
 *
 * Exit codes:
 *   0 — all accounts succeeded (or there were no auto-refresh accounts)
 *   1 — at least one account failed; details printed to stderr
 *
 * Filename note: kept as `refresh-fedex-fuel.ts` so the existing Railway
 * cron service command (`npm run cron:refresh-fuel`) keeps working — the
 * script now covers DHL too but the filename predates the dispatcher.
 */

import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { refreshCarrierFuel } from '@/features/carrier-rates/fuel-fetcher/apply';

import { chayCron } from '@/features/jobs/run';
async function main(): Promise<void> {
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
        inArray(schema.carriers.key, ['fedex', 'dhl', 'ups', 'sf-express']),
        eq(schema.carrierAccounts.enabled, true),
      ),
    );

  if (accounts.length === 0) {
    process.stdout.write('refresh-carrier-fuel: no enabled auto-refresh accounts; nothing to do.\n');
    return;
  }

  let failures = 0;
  for (const account of accounts) {
    try {
      const applied = await refreshCarrierFuel({
        carrierAccountId: account.id,
        triggeredBy: null,
      });
      const change = applied.changed
        ? `${applied.previousPercent ?? '∅'}% → ${applied.newPercent}%`
        : `unchanged at ${applied.newPercent}%`;
      process.stdout.write(
        `refresh-carrier-fuel: [${applied.carrierKey}] ${account.name} — ${change}\n`,
      );
    } catch (err) {
      failures += 1;
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `refresh-carrier-fuel: [${account.carrierKey ?? '?'}] ${account.name} — FAILED: ${msg}\n`,
      );
    }
  }

  if (failures > 0) {
    process.exitCode = 1;
  }
}

chayCron('refresh-fuel', main);
