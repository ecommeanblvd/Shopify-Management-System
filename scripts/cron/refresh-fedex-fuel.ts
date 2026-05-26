/**
 * Standalone Railway-friendly cron entry point.
 * Usage: `npm run cron:refresh-fuel`
 *
 * Iterates every enabled FedEx carrier account and refreshes its
 * fuel_percent surcharge from FedEx's public AEM service. Writes audit
 * columns (last_auto_fetched_at, last_auto_source).
 *
 * Why a script instead of HTTP-pinging the API route?
 * - On Railway we typically wire a "Cron" service that shares the DATABASE_URL
 *   of the main service. The cron service just runs this script, hitting the
 *   DB directly — no HTTP layer, no Bearer-token dance.
 * - The `/api/cron/refresh-fuel` API route is still present for external
 *   cron services (cron-job.org, EasyCron) that want to fire over HTTPS.
 *
 * Exit codes:
 *   0 — all accounts succeeded (or there were no FedEx accounts to refresh)
 *   1 — at least one account failed; details printed to stderr
 */

import { eq, and } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { refreshFedExFuel } from '@/features/carrier-rates/fuel-fetcher/apply';

async function main(): Promise<void> {
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

  if (accounts.length === 0) {
    process.stdout.write('refresh-fedex-fuel: no enabled FedEx accounts; nothing to do.\n');
    return;
  }

  let failures = 0;
  for (const account of accounts) {
    try {
      const applied = await refreshFedExFuel({
        carrierAccountId: account.id,
        triggeredBy: null,
      });
      const change = applied.changed
        ? `${applied.previousPercent ?? '∅'}% → ${applied.newPercent}%`
        : `unchanged at ${applied.newPercent}%`;
      process.stdout.write(`refresh-fedex-fuel: ${account.name} — ${change}\n`);
    } catch (err) {
      failures += 1;
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`refresh-fedex-fuel: ${account.name} — FAILED: ${msg}\n`);
    }
  }

  if (failures > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    process.stderr.write(`refresh-fedex-fuel: fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    // Drizzle's pg pool holds the process open otherwise.
    process.exit();
  });
