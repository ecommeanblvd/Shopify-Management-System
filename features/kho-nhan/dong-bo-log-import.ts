/**
 * Đồng bộ bảng Lark `LOG - Import` (đồ khách trả về) về SMS (CEO 08/10/2026).
 *
 * CỐ Ý KHÔNG có `'use server'` — việc của cron, không phải endpoint.
 *
 * Bảng nằm ở base WH (`HxfAw0iRViHiNgkSlbBltpVkg3f`), table `tbl84nMP8vQwxXfX`. CHỈ ĐỌC. Ô tìm
 * của màn Nhận hàng chạy theo từng phím gõ nên phải soi bản sao, không gọi Lark từng lượt —
 * cùng lý lẽ `dong-bo-po-lark.ts`.
 *
 * Ba cột cần đọc đều là cột LOOKUP trên Lark (`Order number`, `SKU`, `WH - Tiếp nhận & QC`),
 * nên dùng `docChuO` chứ không dùng các bản đọc cục bộ cũ — xem ghi chú ở `features/lark/doc-o.ts`.
 */
import { sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { listLogImportRecords, type LarkRecord } from '@/features/lark/client';
import { docChuO, docSoO } from '@/features/lark/doc-o';
import { boDauTiengViet } from '@/features/kol/bo-dau';
/* Luật cửa vào khai MỘT chỗ ở `return-con-nhan.ts`; ở đây gọi lại nó để đếm, không chép điều kiện. */
import { returnConNhanDuoc } from './return-con-nhan';

/**
 * THUẦN: một record Lark → một dòng bản sao.
 *
 * Số lượng thiếu/không đọc được coi là 1: bảng thật mỗi dòng một món trả về, và 0 sẽ làm dòng
 * trông như đã nhận đủ — cùng lý lẽ `dungDongPo`.
 */
export function dungDongLogImport(r: LarkRecord) {
  const f = r.fields;
  const sl = docSoO(f.Quantity);
  const don = docChuO(f['Order number']);
  const sku = docChuO(f.SKU);
  return {
    recordId: r.record_id,
    /* Giữ NGUYÊN dấu `#` như Lark trả về. Bốn cột lookup `WH -` trên chính bảng đó khớp dòng
     * WH - Inventory theo đúng chuỗi này, nên strip `#` ở đây là tự tạo lệch với bảng vận hành. */
    orderNumber: don,
    sku,
    requestId: docChuO(f['Request ID']),
    returnStatus: docChuO(f['Return Status']),
    logStatus: docChuO(f['LOG-IP-Return Status']),
    returnCategory: docChuO(f['LOG-IP-Return Category']),
    soLuong: sl != null && sl > 0 ? Math.round(sl) : 1,
    whTiepNhanQc: docChuO(f['WH - Tiếp nhận & QC']),
    timKiem: boDauTiengViet(`${don ?? ''} ${sku ?? ''}`).toLowerCase(),
    capNhatLuc: new Date(),
  };
}

export async function dongBoLogImport(): Promise<{ doc: number; ghi: number; choNhan: number }> {
  const ds = await listLogImportRecords();
  const dong = ds.map(dungDongLogImport);
  let ghi = 0;
  // Chia lô 500: một câu insert nghìn dòng vượt trần tham số của Postgres.
  for (let i = 0; i < dong.length; i += 500) {
    const lo = dong.slice(i, i + 500);
    await db.insert(schema.larkLogImport).values(lo).onConflictDoUpdate({
      target: schema.larkLogImport.recordId,
      set: {
        orderNumber: sql`excluded.order_number`, sku: sql`excluded.sku`,
        requestId: sql`excluded.request_id`, returnStatus: sql`excluded.return_status`,
        logStatus: sql`excluded.log_status`, returnCategory: sql`excluded.return_category`,
        soLuong: sql`excluded.so_luong`, whTiepNhanQc: sql`excluded.wh_tiep_nhan_qc`,
        timKiem: sql`excluded.tim_kiem`, capNhatLuc: sql`excluded.cap_nhat_luc`,
      },
    });
    ghi += lo.length;
  }
  /* Đếm số dòng đang ở cửa nhận, để lượt chạy tự khai con số thay vì phải đi hỏi CSDL. Cùng lý
   * lẽ trường `cheDo` của `day-can-lark`: một lượt chạy phải nói được nó thấy gì.
   *
   * Gọi CHÍNH `returnConNhanDuoc` chứ không chép lại điều kiện. Bản đầu chỉ xét trạng thái +
   * cột lookup nên báo 42 trong khi ô tìm hiện 25 — thiếu điều kiện "phải có mã đơn và SKU",
   * mà bảng có 205/666 dòng trống một trong hai. Một bộ đếm nói khác màn hình thì tệ hơn không
   * có bộ đếm: người đọc tin nó rồi đi tìm 17 dòng không tồn tại.
   *
   * `daNhanSms = 0` nên đây là GIỚI HẠN TRÊN: chưa trừ số chiếc SMS đã nhận cho từng dòng. Bộ
   * đếm này để chẩn đoán, không phải để đối soát; muốn số chính xác thì đọc ô tìm. */
  const choNhan = dong.filter((d) => returnConNhanDuoc({
    recordId: d.recordId, orderNumber: d.orderNumber, sku: d.sku, soLuong: d.soLuong,
    whTiepNhanQc: d.whTiepNhanQc, logStatus: d.logStatus,
  }, 0).ok).length;
  return { doc: ds.length, ghi, choNhan };
}
