/**
 * Standalone Railway-friendly cron entry point.
 * Usage: `npm run cron:cogs-own`
 *
 * Giá vốn hàng TỰ SẢN XUẤT (tinhatelier, mirermirer-official, meanblvd/MEAN
 * BLVD — spec 2026-09-08 "Giá vốn theo line đơn + Lãi gộp theo tháng"):
 *   1. `sync-unit-cost` — đọc "Cost per item" từ Shopify → `sku_costs`.
 *   2. `apply-own-cogs` — ghi `order_line_cogs` theo line từ `sku_costs` vừa
 *      đồng bộ (lồng trong (1) qua `chayMotJob`, cùng mẫu `sync-lark.ts` lồng
 *      `push-nhan-hang`).
 *
 * Cờ `DRY_RUN=1`: chỉ in số liệu (đọc được bao nhiêu, SẼ ghi bao nhiêu),
 * KHÔNG ghi gì vào `sku_costs`/`order_line_cogs`.
 *
 * Exit codes:
 *   0 — chạy xong (kể cả khi một vài store lỗi — xem `loi` trong log)
 *   1 — lỗi nghiêm trọng (fatal)
 */
import { chayCron, chayMotJob } from '@/features/jobs/run';
import { syncUnitCost } from '@/features/cogs/unit-cost-sync';
import { applyOwnCogs } from '@/features/cogs/own-cogs';

const dryRun = process.env.DRY_RUN === '1';

async function main(): Promise<void> {
  const s = await syncUnitCost({ dryRun });
  process.stdout.write(
    `sync-unit-cost: ${s.stores} store, đọc ${s.doc} biến thể có giá, ${s.ghi} SKU giá đổi (sẽ ghi), bỏ qua (giá không đổi) ${s.boQua}` +
    `${s.loi.length ? `, lỗi ${s.loi.length}` : ''}${dryRun ? ' [DRY_RUN — không ghi]' : ''}\n`,
  );
  for (const l of s.loi) process.stderr.write(`  lỗi: ${l}\n`);

  await chayMotJob('apply-own-cogs', async () => {
    const r = await applyOwnCogs({ dryRun });
    process.stdout.write(
      `apply-own-cogs: xem xét ${r.xemXet} line, ghi ${r.ghi}, không có giá ${r.khongCoGia}` +
      `${dryRun ? ' [DRY_RUN — không ghi]' : ''}\n`,
    );
    return r;
  });
}

chayCron('sync-unit-cost', main);
