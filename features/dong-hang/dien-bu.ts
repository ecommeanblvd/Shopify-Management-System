/**
 * Phần THUẦN của cron điền bù (Task 7): chọn kiện nào còn cần thử ghi lại giá
 * ước tính lên Lark, và khoá giới hạn số kiện mỗi lượt.
 *
 * `canDienBu` lặp lại ba điều kiện mà `ghiGiaUocTinhLenLark` đã tự gác — xem bình
 * luận cột `gia_uoc_tinh_ghi_luc` trong db/schema.ts: có mã vận đơn (chưa dán thì
 * chưa tới lượt gửi), có dòng Lark tương ứng (chưa có thì chưa biết ghi vào ô nào)
 * và dấu CÒN TRỐNG (có dấu nghĩa là ghi xong, đang có người giành việc, hoặc xác
 * định sẽ không bao giờ ghi được — cả ba cron không được đụng vào) — CỘNG hai điều
 * kiện riêng của cron: mã vận đơn phải do NHÂN SỰ NHẬP QUA HỆ THỐNG (dấu
 * `tracking_nhap_luc`, xem `DAU_NHAP_QUA_HE_THONG` dưới) và kiện phải tạo từ
 * `MOC_DIEN_BU` trở đi. Tách hàm riêng để tự kiểm (test) được mà không cần DB.
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

/**
 * PHẠM VI do CEO chốt 14/10/2026: tính năng CHỈ chạy cho kiện mà nhân sự nhập mã vận đơn
 * QUA HỆ THỐNG, từ nay trở đi. Dấu phân biệt là `shipments.tracking_nhap_luc` — chỉ
 * `luuTrackingChoKien` ghi nó (cùng lệnh UPDATE lưu mã), nên dấu CÓ ⇔ mã do action nhập.
 *
 * Vì sao `MOC_DIEN_BU` một mình KHÔNG đủ: mốc lọc theo `created_at` của KIỆN, không nói gì
 * về việc mã vận đơn tới từ đâu. Kiện do đồng bộ Lark tạo sau 12/10 và mang tracking do
 * chính lượt đồng bộ đó ghi (`features/lark/sync.ts` / webhook `nhan-mot-dong.ts` →
 * `patch-kien.ts`) vẫn thoả đủ bốn điều kiện cũ ⇒ cron bốc nó và đổ giá ước tính lên dòng
 * Lark mà KHÔNG ai ở đây từng chạm vào kiện đó. Kiện nhập từ hoá đơn/XLSX
 * (`features/shipments/import-actions.ts`) cũng vậy. Dấu này chặn đúng hai đường đó.
 *
 * GIỮ cả `MOC_DIEN_BU` (hai điều kiện AND, không thay thế): dấu là khoá chính, mốc là khoá
 * thứ hai cho ca ai đó backfill `tracking_nhap_luc` bằng tay — migration 0205 nói rõ KHÔNG
 * backfill, nhưng một cột trống chỉ cần một câu UPDATE là mất tác dụng, còn mốc thì không
 * backfill được. Giá của việc giữ mốc: kiện tạo TRƯỚC 12/10 mà nhân sự nhập mã hôm nay thì
 * cron không thử lại giúp (bản thân action vẫn ghi ngay và vẫn báo `canhBao`) — CEO muốn bỏ
 * mốc thì xoá điều kiện `taoLuc` ở dưới là đủ, dấu này một mình đã chặn hết kiện lịch sử.
 */
export const DAU_NHAP_QUA_HE_THONG = 'shipments.tracking_nhap_luc';

export interface KienCanDienBu {
  id: string;
  trackingNumber: string | null;
  larkRecordId: string | null;
  daGhiGiaLuc: Date | null;
  taoLuc: Date | null;
  /** Dấu `tracking_nhap_luc`: null = mã KHÔNG do nhân sự nhập qua hệ thống ⇒ ngoài phạm vi. */
  trackingNhapLuc: Date | null;
}

/**
 * THUẦN: kiện này còn cần cron thử ghi lại giá ước tính lên Lark không.
 *
 * `trackingNhapLuc` null → KHÔNG: mã vận đơn không do nhân sự nhập qua hệ thống (đồng bộ
 * Lark, nhập hoá đơn/XLSX, hoặc chưa có mã) ⇒ ngoài phạm vi, xem `DAU_NHAP_QUA_HE_THONG`.
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
  trackingNhapLuc: Date | null;
}): boolean {
  return k.trackingNumber != null && k.larkRecordId != null && k.daGhiGiaLuc == null
    && k.trackingNhapLuc != null
    && k.taoLuc != null && k.taoLuc.getTime() >= MOC_DIEN_BU.getTime();
}

/**
 * I/O: lấy tối đa `SO_KIEN_MOI_LUOT` kiện có khả năng cần điền bù. Lọc sẵn ở
 * SQL đúng các điều kiện của `canDienBu` để không kéo cả bảng `shipments` về —
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
      trackingNhapLuc: schema.shipments.trackingNhapLuc,
    })
    .from(schema.shipments)
    .where(
      and(
        isNotNull(schema.shipments.trackingNumber),
        isNotNull(schema.shipments.larkRecordId),
        isNull(schema.shipments.giaUocTinhGhiLuc),
        /* PHẠM VI: chỉ mã do nhân sự nhập qua hệ thống — xem DAU_NHAP_QUA_HE_THONG. Điều
         * kiện này PHẢI có ở cả SQL và `canDienBu`: thiếu ở SQL thì 20 suất của
         * `SO_KIEN_MOI_LUOT` bị kiện đồng bộ-từ-Lark chiếm hết rồi `canDienBu` loại sạch,
         * lượt cron thành rỗng mà kiện thật vẫn nằm chờ. */
        isNotNull(schema.shipments.trackingNhapLuc),
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

export interface KetQuaDienBu {
  tongSoXetDuyet: number;
  ghiDuoc: number;
  boQua: number;
  canhBaos: string[];
}

/**
 * MỘT lượt điền bù: chọn kiện lỡ nhịp rồi thử ghi giá lên Lark cho từng kiện.
 *
 * Ở ĐÂY chứ không trong route (BL-2, 27/10/2026): bản đầu đặt hàm này ngay trong
 * `app/api/cron/dien-bu-gia-uoc-tinh/route.ts`, và route đó **chưa bao giờ được gọi** — không
 * npm script, không cron service trong `.railway/railway.ts`, `job_runs` 0 lượt. Giao diện thì
 * hứa với nhân sự *"cron sẽ thử lại"*, nên kiện PK-22436 nằm im 20 giờ và thành báo lỗi BL-2.
 * Đưa ra module dùng chung để cron script, route, và lượt chạy tay đều đi CHUNG một đường —
 * đúng thứ D-045 đòi.
 *
 * CHẠY TUẦN TỰ, không `Promise.all`: mỗi kiện là một lượt API giá của hãng cộng hai lượt Lark;
 * bắn song song là dội cả hai bên cùng lúc. `SO_KIEN_MOI_LUOT` giới hạn quy mô mỗi lượt.
 */
export async function chayDienBuGiaUocTinh(): Promise<KetQuaDienBu> {
  const { ghiGiaUocTinhLenLark } = await import('./ghi-gia-uoc-tinh-len-lark');
  const kiens = await layKienCanDienBu();
  let ghiDuoc = 0;
  let boQua = 0;
  const canhBaos: string[] = [];

  for (const k of kiens) {
    // Phòng dữ liệu đổi giữa lúc đọc danh sách (SQL) và lúc xử lý tới dòng này — xử lý tuần
    // tự nên có thể có khoảng cách thời gian đáng kể.
    if (!canDienBu(k)) { boQua++; continue; }
    try {
      const r = await ghiGiaUocTinhLenLark(k.id);
      if (r.giaDaGhi) ghiDuoc++; else boQua++;
      if (r.canhBao) canhBaos.push(`${k.id}: ${r.canhBao}`);
    } catch (e) {
      // `ghiGiaUocTinhLenLark` đã tự bọc try/catch nên nhánh này hiếm khi tới, nhưng một kiện
      // hỏng bất ngờ KHÔNG được chặn các kiện sau trong lượt.
      boQua++;
      canhBaos.push(`${k.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { tongSoXetDuyet: kiens.length, ghiDuoc, boQua, canhBaos: canhBaos.slice(0, 20) };
}
