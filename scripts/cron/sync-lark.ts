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
import { dongBoWhInventory } from '@/features/kho-nhan/dong-bo-wh-lark';
import { dongBoCanTuLark } from '@/features/kho-nhan/dong-bo-can-lark';
import { listAllWhInventoryRecords, type LarkRecord } from '@/features/lark/client';
import { dienStoreFinal } from '@/features/kho-nhan/dien-store-final';
import { dongBoPoLark } from '@/features/kho-nhan/dong-bo-po-lark';
import { dayProductionTime } from '@/features/shopify-orders/day-production-time-lark';
import { backfillCourierLark } from '@/features/lark/courier-backfill';
import { ghiNguocLark } from '@/features/lark/ghi-nguoc/ghi-nguoc';
import { backfillNhanHangLark } from '@/features/lark/nhan-hang-backfill';
import { syncLarkDonShipHo } from '@/features/ship-ho/sync-lark-don';
async function main(): Promise<void> {
  // ĐẶT ĐẦU TIÊN, không phải cuối: `syncLarkPacks` gọi trực tiếp (không qua chayMotJob)
  // nên nó ném lỗi là cả script dừng, mọi việc phía sau không chạy. Việc này lại độc lập
  // và chỉ mất vài giây, trong khi sync-lark có lượt kéo dài 70 phút.
  // Bảng đơn ship hộ của đội logistics: Đức lên đơn trên Lark trước, hệ thống nhập sau nên
  // ngày gửi trên hệ thống là ngày ngồi nhập (CEO 11/09/2026).
  await chayMotJob('sync-lark-ship-ho', () => syncLarkDonShipHo());

  const s = await syncLarkPacks({ giuRecords: true });
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

  // Ghi ngược trạng thái giao, ngày giao, chi phí hãng lên LOG-Export (spec 19/09/2026). Dùng lại
  // record vừa tải — không đọc Lark thêm lượt nào. Gác env LARK_GHI_NGUOC ('dry' → chỉ báo cáo).
  await chayMotJob('ghi-nguoc-lark', () => ghiNguocLark(s.records ?? []), (tt) => {
    const t = tt as { loi: number; loiMau?: string };
    return t.loi > 0 ? `${t.loi} dòng ghi lỗi — ${t.loiMau ?? ''}` : null;
  });

  // "MEAN đã nhận" từ kho quét trên SMS → bảng Lark WH (kèm Mã món). Gác env
  // LARK_NHAN_HANG_PUSH tới khi ops tạo cột "Mã món". Nhật ký riêng để trang
  // giám sát thấy nó chạy hay không.
  await chayMotJob('push-nhan-hang', backfillNhanHangLark);

  /* BA TÁC VỤ LARK DƯỚI ĐÂY CHẠY LỒNG Ở ĐÂY, không qua run-group (CEO 29/09/2026).
   *
   * Vì sao: nhóm 'moi-6-gio' trong groups.ts KHÔNG CÓ service nào chạy — đo
   * job_runs 29/09 thì `dong-bo-wh-lark`, `sync-dispute`, `day-production-time-cx`,
   * `gom-bang-ke-nhap`, `dien-store-final` CHƯA CHẠY LẦN NÀO kể từ khi được khai.
   * Các service cron trên Railway là MỖI VIỆC MỘT SERVICE (cron-track-shipments,
   * cron-sync-lifecycle…), không có service nào gọi `run-group`. Nên khai vào
   * nhóm là khai suông.
   *
   * Đặt ở CUỐI: ba việc này không phải nguồn dữ liệu của phần trên, hỏng cũng
   * không được kéo theo phần đồng bộ chính. `chayCron` ghi mỗi việc một dòng
   * job_runs nên trang giám sát vẫn thấy từng việc.
   *
   * Thời lượng đo 29/09: sync-lark 80s + dong-bo-wh-lark 109s + dien-store-final
   * ~60s + day-production-time-cx 26s ≈ 4,5 phút, lịch mỗi giờ — còn rất thừa chỗ.
   */
  // Tải bảng WH - Inventory MỘT LẦN rồi chia cho hai việc: một lượt đọc là 19 lượt gọi
  // Lark + ~2 phút cho 9.122 dòng, đọc lại lần nữa cho cùng dữ liệu là trả giá hai lần.
  // Để lượt tải BÊN TRONG chayMotJob (không nhấc ra ngoài): Lark sập thì chỉ việc này đỏ
  // và có dòng job_runs, ba việc dưới vẫn chạy. Nhấc ra ngoài là cả script chết câm.
  const daiWh: { dong: LarkRecord[] | null } = { dong: null };
  await chayMotJob('dong-bo-wh-lark', async () => {
    daiWh.dong = await listAllWhInventoryRecords();
    return dongBoWhInventory(daiWh.dong);
  });
  // Cân từng chiếc kho điền trên Lark → điền vào ô cân còn trống bên mình (CEO 30/09/2026).
  // `?? undefined` để nếu việc trên ngã thì việc này tự tải lại, chứ không lặng lẽ không làm gì.
  await chayMotJob('dong-bo-can-lark', () => dongBoCanTuLark(daiWh.dong ?? undefined));
  // Điền Store final SAU khi đã đồng bộ, để dòng mới về là điền được ngay.
  await chayMotJob('dien-store-final', () => dienStoreFinal());
  await chayMotJob('day-production-time-cx', () => dayProductionTime());
  // Bảng PO cho màn Nhận hàng (CEO 29/09/2026) — CHỈ ĐỌC từ Lark.
  await chayMotJob('dong-bo-po-lark', dongBoPoLark);
}

chayCron('sync-lark', main);
