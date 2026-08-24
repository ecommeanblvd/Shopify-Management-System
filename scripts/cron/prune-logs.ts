/**
 * Standalone Railway-friendly cron entry point.
 * Usage: `npm run cron:prune-logs`
 *
 * Dọn các bảng chỉ-ghi (log webhook Shopify, JSON thô của quote FedEx) để
 * database không phình lại tới trần 500MB của Supabase. Chạy hàng tuần là đủ.
 *
 * Exit codes: 0 — chạy xong; 1 — lỗi fatal.
 */

import { pruneOldLogs } from '@/features/db-maintenance/prune-logs';

async function main(): Promise<void> {
  const results = await pruneOldLogs();
  for (const r of results) {
    process.stdout.write(`prune-logs: ${r.moTa} → ${r.rows.toLocaleString('vi-VN')} dòng (mốc ${r.cutoff.slice(0, 10)})\n`);
  }
  const tong = results.reduce((s, r) => s + r.rows, 0);
  process.stdout.write(`prune-logs: tổng ${tong.toLocaleString('vi-VN')} dòng đã dọn\n`);
}

main()
  .catch((err) => {
    process.stderr.write(`prune-logs: fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
