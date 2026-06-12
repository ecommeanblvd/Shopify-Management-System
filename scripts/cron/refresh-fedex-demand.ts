/**
 * Standalone Railway-friendly cron entry point.
 * Usage: `npm run cron:refresh-demand`
 *
 * Checks the FedEx Vietnam Demand-Surcharge page for NEW periods (whose
 * effectiveFrom isn't already a startsAt in the FedEx demand_per_kg config),
 * parses them, and records an audit alert per new period. It does NOT
 * auto-apply config — applying stays a deliberate, reviewed step (the
 * backfill script).
 *
 * Why a script instead of HTTP-pinging the API route?
 * - On Railway we typically wire a "Cron" service that shares the DATABASE_URL
 *   of the main service. The cron service just runs this script, hitting the
 *   DB directly — no HTTP layer, no Bearer-token dance.
 * - The `/api/cron/refresh-demand` API route is still present for external
 *   cron services (cron-job.org, EasyCron) that want to fire over HTTPS.
 *
 * Exit codes:
 *   0 — check ran (regardless of whether new periods were found)
 *   1 — fatal error before/while checking
 */

import { checkFedExDemandUpdates } from '@/features/carrier-rates/demand-fetcher/alert';

async function main(): Promise<void> {
  const result = await checkFedExDemandUpdates();

  process.stdout.write(
    `refresh-fedex-demand: checked at ${result.checkedAt.toISOString()} — ` +
      `${result.newPeriods.length} new period(s), ${result.parseErrors.length} parse error(s).\n`,
  );

  for (const p of result.newPeriods) {
    const rates = Object.entries(p.exportRates)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    process.stdout.write(
      `  NEW: ${p.from} → ${p.to ?? 'open'} | ${rates || '(no rates)'} | ${p.url}\n`,
    );
  }

  for (const e of result.parseErrors) {
    process.stderr.write(`  parse error: ${e.url} — ${e.error}\n`);
  }
}

main()
  .catch((err) => {
    process.stderr.write(
      `refresh-fedex-demand: fatal: ${err instanceof Error ? err.stack : String(err)}\n`,
    );
    process.exitCode = 1;
  })
  .finally(() => {
    // Drizzle's pg pool holds the process open otherwise.
    process.exit();
  });
