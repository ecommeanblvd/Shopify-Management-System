/**
 * Standalone Railway-friendly cron entry point.
 * Usage: `npm run cron:sync-lark`
 *
 * Kéo pack từ Lark Bitable → fill/tạo shipments (cân/dims/tracking/carrier),
 * ghi 1 dòng lark_sync_runs. One-way (Lark → hệ thống).
 *
 * Why a script instead of HTTP-pinging the API route?
 * - On Railway we wire a "Cron" service sharing the main service's env
 *   (DATABASE_URL + LARK_*). It just runs this script — no HTTP layer,
 *   no Bearer-token dance.
 * - The `/api/cron/sync-lark` API route stays for external HTTPS cron.
 *
 * Exit codes:
 *   0 — sync ran
 *   1 — fatal error
 */

import { syncLarkPacks } from '@/features/lark/sync';

async function main(): Promise<void> {
  const s = await syncLarkPacks();
  process.stdout.write(
    `sync-lark: tạo ${s.created}, cập nhật ${s.updated}, không khớp ${s.unmatched.length}, skip ${s.skipped}, warning ${s.warnings.length}\n`,
  );
  for (const u of s.unmatched) {
    process.stdout.write(`  unmatched: ${u.orderNumber} — ${u.reason}\n`);
  }
}

main()
  .catch((err) => {
    process.stderr.write(`sync-lark: fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
