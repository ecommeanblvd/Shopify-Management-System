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
 * `main()` PHẢI trả về summary (không được bỏ trống): `chayCron` lưu giá trị
 * trả về vào `job_runs.summary` — bỏ trống thì trang giám sát không thấy số
 * liệu của lần chạy, chỉ thấy "chạy rồi". Lỗi TỪNG STORE ở bước (1) không
 * chặn store khác (xem `syncUnitCost`), NHƯNG không được nuốt im — set
 * `process.exitCode = 1` khi có `loi`, đúng hợp đồng `chayCron`
 * (features/jobs/run.ts: script tự đặt exit code khác 0 thì job được tính là
 * lỗi trên trang giám sát) và cùng mẫu `refresh-surcharges.ts`.
 *
 * Exit codes:
 *   0 — chạy xong, mọi store đọc được
 *   1 — ít nhất 1 store lỗi (xem log `loi`), hoặc lỗi nghiêm trọng (fatal)
 */
import { chayCron, chayMotJob } from '@/features/jobs/run';
import { syncUnitCost, type SyncUnitCostResult } from '@/features/cogs/unit-cost-sync';
import { applyOwnCogs, type ApplyOwnCogsResult } from '@/features/cogs/own-cogs';

const dryRun = process.env.DRY_RUN === '1';

async function main(): Promise<{ sync: SyncUnitCostResult; apply: ApplyOwnCogsResult }> {
  const s = await syncUnitCost({ dryRun });
  process.stdout.write(
    `sync-unit-cost: ${s.stores} store, đọc ${s.doc} biến thể có giá, ${s.ghi} SKU giá đổi (sẽ ghi), bỏ qua (giá không đổi) ${s.boQua}` +
    `${s.loi.length ? `, lỗi ${s.loi.length}` : ''}${dryRun ? ' [DRY_RUN — không ghi]' : ''}\n`,
  );
  for (const l of s.loi) process.stderr.write(`  lỗi: ${l}\n`);
  // Lỗi cục bộ (một store hỏng) vẫn phải làm cron báo đỏ — im lặng ở đây là
  // đúng cái đã khiến addr-verify/track-ship-ho chết âm thầm nhiều tuần (xem
  // features/jobs/registry.ts). `chayCron` đọc process.exitCode để tính
  // ok/error, không tự suy ra từ nội dung summary.
  if (s.loi.length > 0) process.exitCode = 1;

  let apply: ApplyOwnCogsResult = { xemXet: 0, ghi: 0, khongCoGia: 0 };
  const ok = await chayMotJob('apply-own-cogs', async () => {
    apply = await applyOwnCogs({ dryRun });
    process.stdout.write(
      `apply-own-cogs: xem xét ${apply.xemXet} line, ghi ${apply.ghi}, không có giá ${apply.khongCoGia}` +
      `${dryRun ? ' [DRY_RUN — không ghi]' : ''}\n`,
    );
    return apply;
  });
  // `chayMotJob` tự nuốt lỗi (trả false, không throw) để bước (1) ở trên không
  // bị mất nếu bước này hỏng — nhưng cùng lý do ở (1): không được để cron báo
  // xanh khi apply-own-cogs thật ra đã lỗi.
  if (!ok) process.exitCode = 1;

  return { sync: s, apply };
}

chayCron('sync-unit-cost', main);
