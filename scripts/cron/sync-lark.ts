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
import { syncBrandReceived } from '@/features/lark/sync-brand-received';

import { chayCron } from '@/features/jobs/run';
import { backfillCourierLark } from '@/features/lark/courier-backfill';
async function main(): Promise<void> {
  const s = await syncLarkPacks();
  process.stdout.write(
    `sync-lark: tạo ${s.created}, cập nhật ${s.updated}, không khớp ${s.unmatched.length}, skip ${s.skipped}, warning ${s.warnings.length}\n`,
  );
  for (const u of s.unmatched) {
    process.stdout.write(`  unmatched: ${u.orderNumber} — ${u.reason}\n`);
  }
  // Ngày MEAN nhận hàng từ brand (bảng Lark WH) → mmp_line_received — nguồn
  // receivedAt cho payload MMP (công nợ theo kỳ nhận hàng). Best-effort: lỗi
  // không chặn kết quả packs. Trước đây bước này CHỈ có ở route HTTP nên bảng
  // đóng băng 29/06→22/07 (gap 426 đơn by_received phía MMP).
  try {
    const br = await syncBrandReceived();
    process.stdout.write(`brand-received: fetched ${br.fetched}, upserted ${br.upserted}\n`);
  } catch (err) {
    process.stderr.write(`brand-received: lỗi ${err instanceof Error ? err.message : String(err)}\n`);
  }

  // Điền bù cột "Couriers": nhân viên chọn hãng trên hệ thống TRƯỚC khi dòng Lark
  // tồn tại (dòng chỉ sinh lúc đóng hàng), nên ghi ngay lúc chọn gần như luôn
  // trượt. Bám theo nhịp cron này để bên đóng hàng thấy hãng ngay lượt sau.
  // Best-effort: hỏng không chặn kết quả packs.
  try {
    const c = await backfillCourierLark();
    process.stdout.write(`courier→lark: điền ${c.daDien}, đối chiếu ${c.doiChieu}, lệch không ghi đè ${c.lechKhongGhi.length}, lỗi ${c.loi.length}\n`);
    for (const l of c.lechKhongGhi) {
      process.stdout.write(`  lệch: ${l.soDon} — Lark "${l.tenTrenLark}" vs hệ thống "${l.tenHeThong}"\n`);
    }
  } catch (err) {
    process.stderr.write(`courier→lark: lỗi ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

chayCron('sync-lark', main);
