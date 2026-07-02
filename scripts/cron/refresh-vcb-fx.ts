/**
 * Standalone Railway-friendly cron entry point.
 * Usage: `npm run cron:refresh-vcb`
 *
 * Kéo tỉ giá USD/VND từ Vietcombank → cập nhật fxCostPerDisplay cho các carrier
 * account lưu giá USD (Aramex). Chạy sáng hàng ngày.
 *
 * Exit codes: 0 — chạy xong; 1 — lỗi fatal.
 */

import { refreshVcbFx } from '@/features/carrier-rates/fx/refresh-vcb';

async function main(): Promise<void> {
  const r = await refreshVcbFx();
  process.stdout.write(
    `refresh-vcb: VCB sell=${r.sell} → fxCostPerDisplay=${r.fxCostPerDisplay.toExponential(4)} · cập nhật ${r.updated} account\n`,
  );
}

main()
  .catch((err) => {
    process.stderr.write(`refresh-vcb: fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
