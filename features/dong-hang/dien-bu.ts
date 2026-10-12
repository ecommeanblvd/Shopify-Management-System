/**
 * Phần THUẦN của cron điền bù (Task 7): chọn kiện nào còn cần thử ghi lại giá
 * ước tính lên Lark, và khoá giới hạn số kiện mỗi lượt.
 *
 * `canDienBu` lặp lại đúng ba điều kiện mà `ghiGiaUocTinhLenLark` đã tự gác —
 * xem bình luận cột `gia_uoc_tinh_ghi_luc` trong db/schema.ts: có mã vận đơn
 * (chưa dán thì chưa tới lượt gửi), có dòng Lark tương ứng (chưa có thì chưa
 * biết ghi vào ô nào) và CHƯA bị đóng dấu (đã đóng dấu nghĩa là ghi xong, hoặc
 * xác định sẽ không bao giờ ghi được — cả hai trường hợp cron không cần đụng
 * lại). Tách hàm riêng để tự kiểm (test) được mà không cần DB.
 */
import { and, isNotNull, isNull } from 'drizzle-orm';
import { db, schema } from '@/db/client';

/**
 * Giới hạn số kiện xử lý MỖI LƯỢT cron.
 *
 * Vì sao cần: với hãng đi đường bảng giá (Aramex, DHL…), `layGiaUocTinh` gọi
 * `quoteOrderAcrossCarriers`, mà hàm đó LUÔN thử báo giá SỐNG của UPS cho MỌI
 * tài khoản UPS đang bật rồi vứt kết quả đi nếu kiện không phải hàng UPS (chi
 * phí ẩn do lượt soát Task 4 phát hiện). Chạy lẻ một kiện (action nhập
 * tracking) thì vô hại, nhưng cron quét một loạt kiện lỡ nhịp (vd sau một
 * ngày Lark lỗi, nợ đọng dồn lại) sẽ nhân số lượt gọi UPS thừa đó lên theo
 * từng kiện — giới hạn số kiện mỗi lượt để không vô tình dội API UPS.
 */
export const SO_KIEN_MOI_LUOT = 20;

export interface KienCanDienBu {
  id: string;
  trackingNumber: string | null;
  larkRecordId: string | null;
  daGhiGiaLuc: Date | null;
}

/**
 * THUẦN: kiện này còn cần cron thử ghi lại giá ước tính lên Lark không.
 */
export function canDienBu(k: {
  trackingNumber: string | null;
  larkRecordId: string | null;
  daGhiGiaLuc: Date | null;
}): boolean {
  return k.trackingNumber != null && k.larkRecordId != null && k.daGhiGiaLuc == null;
}

/**
 * I/O: lấy tối đa `SO_KIEN_MOI_LUOT` kiện có khả năng cần điền bù. Lọc sẵn ở
 * SQL đúng ba điều kiện của `canDienBu` để không kéo cả bảng `shipments` về —
 * nhưng caller (route cron) VẪN phải chạy lại `canDienBu` trên từng dòng
 * trước khi xử lý, vì xử lý chạy tuần tự nên dữ liệu có thể đổi giữa lúc đọc
 * danh sách và lúc xử lý tới dòng đó.
 */
export async function layKienCanDienBu(): Promise<KienCanDienBu[]> {
  const rows = await db
    .select({
      id: schema.shipments.id,
      trackingNumber: schema.shipments.trackingNumber,
      larkRecordId: schema.shipments.larkRecordId,
      daGhiGiaLuc: schema.shipments.giaUocTinhGhiLuc,
    })
    .from(schema.shipments)
    .where(
      and(
        isNotNull(schema.shipments.trackingNumber),
        isNotNull(schema.shipments.larkRecordId),
        isNull(schema.shipments.giaUocTinhGhiLuc),
      ),
    )
    .limit(SO_KIEN_MOI_LUOT);
  return rows;
}
