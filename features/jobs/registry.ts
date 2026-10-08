/**
 * Sổ đăng ký tác vụ nền: cái gì PHẢI chạy, và bao lâu một lần.
 *
 * Vì sao cần khai tay: repo có 13 file `railway.cron-*.json` nhưng chỉ 1 file
 * khai `cronSchedule` (lịch thật nằm ở Railway dashboard), nên không thể suy ra
 * kỳ vọng từ cấu hình. Danh sách này là NGUỒN SỰ THẬT về việc "đáng lẽ phải
 * chạy" — có nó thì trang giám sát mới phân biệt được "chạy xong rồi" với
 * "chưa ai lên lịch bao giờ".
 *
 * `chuKyPhut` là chu kỳ mong đợi. Quá hạn = quá 2 lần chu kỳ chưa chạy — nhân 2
 * để một lần lỡ nhịp không kêu oan, nhưng ngưng thật thì báo ngay.
 */
export interface JobDinhNghia {
  key: string;
  ten: string;
  /** Chu kỳ mong đợi, tính bằng phút. */
  chuKyPhut: number;
  /** Hỏng thì hậu quả gì — hiện trên trang giám sát để biết cái nào ưu tiên. */
  hauQua: string;
}

const PHUT = 1, GIO = 60, NGAY = 24 * 60;
/** push-nhan-hang chạy LỒNG trong cron sync-lark (scripts/cron/sync-lark.ts gọi backfillNhanHangLark) — chu kỳ phải luôn khớp nhau. */
const CHU_KY_SYNC_LARK = 1 * GIO;

// 07/09/2026 (CEO): bỏ hẳn 8 khoá chưa từng chạy vì service cũ đã xoá —
// sync-warehouse, sync-meanblvd, sync-catalog, sync-geo, create-sale,
// refresh-demand, refresh-vcb-fx, remind-fuel. Mã tính năng vẫn còn trong
// features/, muốn bật lại thì thêm khoá + script + nhóm.
export const JOB_REGISTRY: readonly JobDinhNghia[] = [
  { key: 'sync-orders', ten: 'Đồng bộ đơn Shopify', chuKyPhut: 1 * GIO,
    hauQua: 'Đơn mới không về hệ thống' },
  { key: 'sync-lark', ten: 'Đồng bộ Lark', chuKyPhut: CHU_KY_SYNC_LARK,
    hauQua: 'Bảng Lark lệch với hệ thống' },
  { key: 'sync-lifecycle', ten: 'Đồng bộ vòng đời đơn', chuKyPhut: 6 * GIO,
    hauQua: 'Bảng theo dõi tiến độ đơn đứng im' },
  { key: 'track-shipments', ten: 'Tra trạng thái giao (đơn hàng nhà)', chuKyPhut: 6 * GIO,
    hauQua: 'Không biết đơn đã giao hay chưa' },
  { key: 'track-ship-ho', ten: 'Tra trạng thái giao (ship hộ)', chuKyPhut: 6 * GIO,
    hauQua: 'Đối tác không thấy đơn đã giao' },
  { key: 'nap-ngay-lay-hang', ten: 'Nạp ngày hãng lấy hàng (ship hộ)', chuKyPhut: 6 * GIO,
    hauQua: 'Quá 90 ngày là FedEx xoá lịch sử quét — mất vĩnh viễn ngày đi hàng, phụ phí xăng dầu hết đối chiếu được theo tuần' },
  { key: 'dong-bo-po-lark', ten: 'Đồng bộ bảng PO từ Lark cho màn Nhận hàng', chuKyPhut: 1 * GIO,
    hauQua: 'Hàng đặt PO mới không tìm được khi nhận, và PO vừa nhập đủ vẫn cho chọn tiếp' },
  { key: 'dien-store-final', ten: 'Điền cột Store final còn trống trên bảng kho Lark', chuKyPhut: 6 * GIO,
    hauQua: 'Dòng kho mới không có Store final — đội kho phải điền tay, báo cáo theo store thiếu dòng' },
  { key: 'gom-bang-ke-nhap', ten: 'Gom đơn đã chốt giá vào bảng kê nháp của kỳ', chuKyPhut: 6 * GIO,
    hauQua: 'Đơn đã chốt giá nằm chờ vô thời hạn, không ai biết còn bao nhiêu tiền chưa thu của brand' },
  { key: 'day-production-time-cx', ten: 'Điền Min/Max Production (days) vào file CX Working', chuKyPhut: 6 * GIO,
    hauQua: 'CX không thấy thời gian sản xuất của đơn mới → hẹn ngày với khách bằng tay' },
  { key: 'doi-chieu-ly-do', ten: 'Đối chiếu lý do giao chậm với FedEx', chuKyPhut: 1 * GIO,
    hauQua: 'Lý do chậm mới gán không được xác nhận, kiện vẫn nằm trong mẫu số KPI' },
  { key: 'refresh-owned-store', ten: 'Làm mới đơn store brand sang MMP', chuKyPhut: 1 * GIO,
    hauQua: 'MMP giữ chi phí ship cũ của TINH/Mirer khi hoá đơn về muộn' },
  { key: 'sync-lark-ship-ho', ten: 'Đồng bộ đơn ship hộ từ Lark', chuKyPhut: 1 * GIO,
    hauQua: 'Đơn Đức lên trên Lark không hiện trong hệ thống, ngày gửi bị lệch về ngày nhập' },
  { key: 'refresh-fuel', ten: 'Cập nhật phụ phí xăng dầu', chuKyPhut: 1 * NGAY,
    hauQua: 'Báo giá dùng mức xăng dầu tuần cũ' },
  { key: 'refresh-surcharges', ten: 'Cập nhật phụ phí hãng', chuKyPhut: 1 * NGAY,
    hauQua: 'Bảng phụ phí lạc hậu' },
  { key: 'push-unsent-brand', ten: 'Đẩy đơn brand chưa gửi MMP', chuKyPhut: 1 * GIO,
    hauQua: 'Đơn brand không sang MMP → thiếu đơn khi đối soát công nợ' },
  { key: 'addr-verify', ten: 'Xác minh địa chỉ qua FedEx', chuKyPhut: 1 * GIO,
    hauQua: 'Không biết địa chỉ nhà dân hay doanh nghiệp → tính sai phụ phí' },
  { key: 'ship-ho-tiers', ten: 'Cập nhật bậc chiết khấu ship hộ', chuKyPhut: 1 * NGAY,
    hauQua: 'Brand hưởng sai bậc chiết khấu theo sản lượng' },
  { key: 'apply-pod', ten: 'Áp ngày giao từ hoá đơn (POD)', chuKyPhut: 1 * GIO,
    hauQua: 'Ngày giao chính thức không về hệ thống' },
  { key: 'return-links', ten: 'Nối dòng bill hàng hoàn về đơn gốc', chuKyPhut: 1 * GIO,
    hauQua: 'Cước hàng hoàn không gắn được vào đơn' },
  { key: 'ship-ho-bao-gia', ten: 'Báo giá dự tính đơn ship hộ còn trống', chuKyPhut: 1 * GIO,
    hauQua: 'Đơn về từ Lark không có giá dự tính → đối soát không tính được delta' },
  { key: 'ship-ho-gia-thu', ten: 'Tính giá thu brand cho đơn ship hộ còn trống', chuKyPhut: 1 * GIO,
    hauQua: 'Đơn không có giá thu → không ra được lãi/lỗ và không đối soát công nợ brand' },
  { key: 'ship-ho-reconcile', ten: 'Đối soát ship hộ từ hoá đơn', chuKyPhut: 1 * GIO,
    hauQua: 'Đơn ship hộ không được tính lại giá theo cân thực' },
  { key: 'retry-mmp-orders', ten: 'Đẩy đơn sang MMP', chuKyPhut: 1 * GIO,
    hauQua: 'MMP không nhận được đơn mới → đối soát công nợ brand thiếu đơn' },
  // Chạy LỒNG trong scripts/cron/retry-ship-ho-events.ts nên chu kỳ phải khớp việc đó.
  { key: 'retry-statement-events', ten: 'Gửi lại bản đối soát bảng kê còn kẹt', chuKyPhut: 15 * PHUT,
    hauQua: 'MMP không có bảng kê của SMS để đối chiếu — lệch kỳ/giá không ai phát hiện' },
  { key: 'retry-ship-ho-events', ten: 'Gửi lại sự kiện MMP còn kẹt', chuKyPhut: 15 * PHUT,
    hauQua: 'Sự kiện hỏng nằm kẹt vĩnh viễn, MMP không nhận được' },
  { key: 'push-nhan-hang', ten: 'Đẩy "MEAN đã nhận" + Mã món lên Lark', chuKyPhut: CHU_KY_SYNC_LARK,
    hauQua: 'QC/đóng gói trên Lark không thấy món đã về, MMP thiếu ngày nhận' },
  { key: 'ghi-nguoc-lark', ten: 'Ghi trạng thái giao + chi phí hãng lên Lark', chuKyPhut: CHU_KY_SYNC_LARK,
    hauQua: 'Ops phải gõ tay lại trạng thái giao, ngày giao, chi phí hãng trên LOG-Export' },
  // Nối LỒNG trong syncBrandReceived (chạy nghiệp trong cả sync-lark.ts lẫn route HTTP) —
  // chu kỳ phải khớp CHU_KY_SYNC_LARK (review 23/09/2026, task-3 Finding 2).
  { key: 'noi-line-id-mon', ten: 'Nối món Lark với dòng đơn Shopify (mã tem)', chuKyPhut: CHU_KY_SYNC_LARK,
    hauQua: 'Tem in mã kho tự cấp thay vì mã dòng đơn/biến thể, hoặc món không nối được để dán tem' },
  // CHƯA BẬT (CEO 23/09/2026): kiểm từng bản ghi lên Lark một rồi mới cho chạy tự động.
  // Chu kỳ để 1 NGÀY nên trang giám sát không báo đỏ trong lúc chờ.
  { key: 'dong-bo-wh-lark', ten: 'Kéo bảng Lark WH - Inventory về bản sao', chuKyPhut: 6 * GIO,
    hauQua: 'Sổ nhập & đối chiếu hiện dữ liệu cũ — kho tưởng thiếu hàng hoặc thiếu ngày' },
  // Chạy LỒNG ngay sau `dong-bo-wh-lark` trong scripts/cron/sync-lark.ts, dùng lại bảng
  // Lark việc kia vừa tải nên chu kỳ phải bằng nhau. CHỈ ĐỌC Lark, chỉ điền ô cân còn
  // trống bên mình — không ghi gì lên Lark, không ghi đè số người ta vừa sửa.
  { key: 'dong-bo-can-lark', ten: 'Kéo cân từng chiếc từ Lark về SMS', chuKyPhut: 6 * GIO,
    hauQua: 'Chiếc kho đã cân trên Lark vẫn trống cân trong SMS — bảng Nhận hôm nay thiếu số để tính cước' },
  // Chiều NGƯỢC LẠI, hẹp hơn hẳn: CHỈ điền ô Lark đang trống, không bao giờ ghi đè (CEO
  // 01/10/2026). Mặc định CHẠY THỬ — bật bằng biến RIÊNG `WH_GHI_CAN_LARK`, từng bản ghi một.
  { key: 'day-can-lark', ten: 'Đẩy cân nhập ở SMS lên ô Lark còn trống', chuKyPhut: 6 * GIO,
    hauQua: 'Cân kho gõ ở bảng Nhận hôm nay không bao giờ lên Lark — hai bên lệch số vĩnh viễn' },
  // Chạy LỒNG ngay sau `gom-bang-ke-nhap` trong scripts/cron/sync-shopify-orders.ts.
  { key: 'gom-dieu-chinh', ten: 'Gom dòng điều chỉnh cho kỳ đã phát hành', chuKyPhut: 6 * GIO,
    hauQua: 'Giá đổi sau khi chốt kỳ không bao giờ ra tới brand — SMS giữ số mới, brand đã thu số cũ' },
  { key: 'sync-dispute', ten: 'Kéo tranh chấp (chargeback) từ Shopify Payments', chuKyPhut: 6 * GIO,
    hauQua: 'Hạn nộp bằng chứng hiện sai — ca sắp mất tiền không lên khối "cần phản hồi"' },
  { key: 'day-nhan-kcs-lark', ten: 'Đẩy việc nhận + KCS của kho lên Lark (chưa bật)', chuKyPhut: 1 * NGAY,
    hauQua: 'Việc kho đã làm trên SMS không lên bảng kho Lark' },
  { key: 'lark-pack-webhook', ten: 'Nhận kiện đóng xong từ Lark (webhook)', chuKyPhut: 1 * NGAY,
    hauQua: 'Kiện đóng xong không về SMS tức thì — Đức phải chọn line trên Lark' },
  // Chạy LỒNG trong scripts/cron/sync-lark.ts, sau `dong-bo-po-lark`. CHỈ ĐỌC Lark.
  { key: 'dong-bo-log-import', ten: 'Kéo bảng Lark LOG - Import (đồ return) về bản sao', chuKyPhut: 6 * GIO,
    hauQua: 'Đồ khách trả về không hiện ở ô tìm màn Nhận hàng — kho không nhận được hàng return' },
  { key: 'prune-logs', ten: 'Dọn bảng log', chuKyPhut: 7 * NGAY,
    hauQua: 'Database phình tới trần dung lượng' },
  { key: 'sync-unit-cost', ten: 'Đọc Cost per item từ Shopify', chuKyPhut: 1 * NGAY,
    hauQua: 'Giá vốn hàng tự sản xuất không cập nhật' },
  { key: 'apply-own-cogs', ten: 'Ghi giá vốn hàng tự sản xuất theo line', chuKyPhut: 1 * NGAY,
    hauQua: 'Báo cáo lãi gộp thiếu giá vốn hàng TINH/Mirer/MEAN' },
];

export const JOB_KEYS: readonly string[] = JOB_REGISTRY.map((j) => j.key);

export type TrangThaiJob = 'chua_chay' | 'qua_han' | 'loi' | 'dang_chay' | 'binh_thuong';

export interface LanChayGanNhat {
  startedAt: Date;
  status: string;
  durationMs: number | null;
  error: string | null;
}

/** Quá hạn khi vượt 2 lần chu kỳ mong đợi. */
export function hanChotMs(chuKyPhut: number): number {
  return chuKyPhut * 60_000 * 2;
}

/**
 * THUẦN: trạng thái một tác vụ. Ưu tiên theo mức nghiêm trọng — chưa chạy bao
 * giờ nặng nhất (không ai lên lịch), rồi quá hạn, rồi lần cuối lỗi.
 */
export function trangThaiJob(job: JobDinhNghia, lanCuoi: LanChayGanNhat | null, now: Date): TrangThaiJob {
  if (!lanCuoi) return 'chua_chay';
  const treMs = now.getTime() - lanCuoi.startedAt.getTime();
  if (treMs > hanChotMs(job.chuKyPhut)) return 'qua_han';
  if (lanCuoi.status === 'error') return 'loi';
  // 'running' quá lâu = tiến trình chết giữa chừng, không ai cập nhật lại dòng
  // đó (đo 05/09: 4 dòng kẹt 'running' từ hôm trước). Coi là ĐANG CHẠY mãi thì
  // trang giám sát nói dối — quá một chu kỳ thì tính là lỗi.
  if (lanCuoi.status === 'running') {
    return treMs > job.chuKyPhut * 60_000 ? 'loi' : 'dang_chay';
  }
  return 'binh_thuong';
}

/** Thứ tự hiện trên trang: cái đáng lo lên trước. */
const THU_TU: Record<TrangThaiJob, number> = {
  chua_chay: 0, qua_han: 1, loi: 2, dang_chay: 3, binh_thuong: 4,
};

export function xepTheoMucDoLo<T extends { trangThai: TrangThaiJob }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => THU_TU[a.trangThai] - THU_TU[b.trangThai]);
}

export const NHAN_TRANG_THAI: Record<TrangThaiJob, string> = {
  chua_chay: 'Chưa chạy lần nào',
  qua_han: 'Quá hạn',
  loi: 'Lần cuối lỗi',
  dang_chay: 'Đang chạy',
  binh_thuong: 'Bình thường',
};
