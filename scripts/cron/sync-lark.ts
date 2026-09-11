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

import { chayCron, chayMotJob } from '@/features/jobs/run';
import { backfillCourierLark } from '@/features/lark/courier-backfill';
import { backfillNhanHangLark } from '@/features/lark/nhan-hang-backfill';
import { syncLarkDonShipHo } from '@/features/ship-ho/sync-lark-don';
async function main(): Promise<void> {
  // ĐẶT ĐẦU TIÊN, không phải cuối: `syncLarkPacks` gọi trực tiếp (không qua chayMotJob)
  // nên nó ném lỗi là cả script dừng, mọi việc phía sau không chạy. Việc này lại độc lập
  // và chỉ mất vài giây, trong khi sync-lark có lượt kéo dài 70 phút.
  // Bảng đơn ship hộ của đội logistics: Đức lên đơn trên Lark trước, hệ thống nhập sau nên
  // ngày gửi trên hệ thống là ngày ngồi nhập (CEO 11/09/2026).
  await chayMotJob('sync-lark-ship-ho', () => syncLarkDonShipHo());

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
    process.stdout.write(`brand-received: fetched ${br.fetched}, inserted ${br.inserted}\n`);
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

  // "MEAN đã nhận" từ kho quét trên SMS → bảng Lark WH (kèm Mã món). Gác env
  // LARK_NHAN_HANG_PUSH tới khi ops tạo cột "Mã món". Nhật ký riêng để trang
  // giám sát thấy nó chạy hay không.
  await chayMotJob('push-nhan-hang', backfillNhanHangLark);
}

chayCron('sync-lark', main);
