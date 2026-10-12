/**
 * Phần THUẦN của cron điền bù (Task 7): chọn kiện nào còn cần thử ghi lại giá
 * ước tính lên Lark, và khoá giới hạn số kiện mỗi lượt.
 *
 * `canDienBu` lặp lại ba điều kiện mà `ghiGiaUocTinhLenLark` đã tự gác — xem bình
 * luận cột `gia_uoc_tinh_ghi_luc` trong db/schema.ts: có mã vận đơn (chưa dán thì
 * chưa tới lượt gửi), có dòng Lark tương ứng (chưa có thì chưa biết ghi vào ô nào)
 * và dấu CÒN TRỐNG (có dấu nghĩa là ghi xong, đang có người giành việc, hoặc xác
 * định sẽ không bao giờ ghi được — cả ba cron không được đụng vào) — CỘNG một điều
 * kiện riêng của cron: kiện phải tạo từ `MOC_DIEN_BU` trở đi (xem dưới). Tách hàm
 * riêng để tự kiểm (test) được mà không cần DB.
 */
import { and, asc, gte, isNotNull, isNull } from 'drizzle-orm';
import { db, schema } from '@/db/client';

/**
 * Giới hạn số kiện xử lý MỖI LƯỢT cron.
 *
 * Vì sao cần: mỗi kiện là một lượt gọi API giá của hãng (FedEx/UPS) hoặc một lượt
 * nạp snapshot bảng giá, cộng hai lượt Lark. Cron quét một loạt kiện lỡ nhịp (vd
 * sau một ngày Lark lỗi, nợ đọng dồn lại) mà không có trần là dội API hãng theo
 * từng kiện. (Lượt gọi UPS THỪA cho kiện Aramex/DHL mà lượt soát Task 4 phát hiện
 * đã hết: `layGiaUocTinh` gọi `baoGiaBangGiaMotHang` cho đúng hãng của kiện, không
 * còn qua `quoteOrderAcrossCarriers`.)
 */
export const SO_KIEN_MOI_LUOT = 20;

/**
 * Cron CHỈ điền bù cho kiện tạo từ mốc này — tính năng nhập tracking lên nhánh 12/10/2026.
 *
 * Vì sao phải có mốc: ba điều kiện kia (có mã vận đơn · có dòng Lark · chưa đóng dấu) đúng
 * với **4.276 kiện trải 4 tháng lịch sử** (đo thật: 4.217 kiện cũ hơn 7 ngày, sớm nhất
 * 10/06/2026). Không có mốc thì lượt cron ĐẦU TIÊN đổ giá ước tính hôm nay lên 4 tháng dòng
 * Lark cũ và lấp vĩnh viễn mọi ô trống còn lại của chúng — đúng loại hỏng không sửa lại được
 * bằng máy. "Kiện lỡ nhịp" mà cron sinh ra để cứu là kiện VỪA được dán mã qua luồng mới, chứ
 * không phải toàn bộ lịch sử.
 *
 * Kiện cũ hơn mốc mà thật sự cần điền bù thì chạy tay (xoá dấu + gọi `ghiGiaUocTinhLenLark`),
 * có người ngồi xem từng kiện — không để cron tự quyết trên 4.000 dòng.
 */
export const MOC_DIEN_BU = new Date('2026-10-12T00:00:00.000Z');

export interface KienCanDienBu {
  id: string;
  trackingNumber: string | null;
  larkRecordId: string | null;
  daGhiGiaLuc: Date | null;
  taoLuc: Date | null;
}

/**
 * THUẦN: kiện này còn cần cron thử ghi lại giá ước tính lên Lark không.
 *
 * `taoLuc` trước `MOC_DIEN_BU` → KHÔNG: đó là kiện lịch sử, xem `MOC_DIEN_BU`. `taoLuc` null
 * (không đọc được) cũng KHÔNG — không biết kiện thuộc thời nào thì không ghi, giống mọi lựa
 * chọn khác trong tính năng này.
 */
export function canDienBu(k: {
  trackingNumber: string | null;
  larkRecordId: string | null;
  daGhiGiaLuc: Date | null;
  taoLuc: Date | null;
}): boolean {
  return k.trackingNumber != null && k.larkRecordId != null && k.daGhiGiaLuc == null
    && k.taoLuc != null && k.taoLuc.getTime() >= MOC_DIEN_BU.getTime();
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
      taoLuc: schema.shipments.createdAt,
    })
    .from(schema.shipments)
    .where(
      and(
        isNotNull(schema.shipments.trackingNumber),
        isNotNull(schema.shipments.larkRecordId),
        isNull(schema.shipments.giaUocTinhGhiLuc),
        // Mốc thời gian: xem MOC_DIEN_BU. Lọc ngay ở SQL để không kéo 4.276 dòng lịch sử về.
        gte(schema.shipments.createdAt, MOC_DIEN_BU),
      ),
    )
    /* Thứ tự ổn định, kiện cũ trước: không có ORDER BY thì Postgres trả thứ tự nào cũng
     * được, nên hai lượt cron liên tiếp có thể bốc lại đúng một nhóm kiện và bỏ đói nhóm
     * còn lại mãi mãi khi nợ đọng nhiều hơn `SO_KIEN_MOI_LUOT`. */
    .orderBy(asc(schema.shipments.createdAt), asc(schema.shipments.id))
    .limit(SO_KIEN_MOI_LUOT);
  return rows;
}
