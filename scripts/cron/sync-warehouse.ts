/**
 * Standalone Railway-friendly cron entry point.
 * Usage: `npm run cron:sync-warehouse`
 *
 * Đối soát tồn kho Lark "WH - Inventory" → SMS warehouse_inventory, đi qua sổ cái
 * (applyMovement) để giữ qty_reserved. Một chiều (Lark → hệ thống).
 *
 * Exit codes: 0 — chạy xong; 1 — lỗi fatal.
 */

import { syncWarehouseFromLark } from '@/features/warehouse/lark-sync';

async function main(): Promise<void> {
  const s = await syncWarehouseFromLark();
  process.stdout.write(
    `sync-warehouse: larkRows ${s.larkRows}, larkSkus ${s.larkSkus}, planned ${s.planned}, `
    + `added ${s.added}, adjusted ${s.adjusted}, zeroed ${s.zeroed}, `
    + `cappedByReserved ${s.cappedByReserved}, errors ${s.errors.length}\n`,
  );
  if (s.errors.length) process.exitCode = 1;
}

main()
  .catch((err) => {
    process.stderr.write(`sync-warehouse: fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
