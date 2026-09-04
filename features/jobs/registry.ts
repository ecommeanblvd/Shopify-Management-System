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

export const JOB_REGISTRY: readonly JobDinhNghia[] = [
  { key: 'sync-orders', ten: 'Đồng bộ đơn Shopify', chuKyPhut: 1 * GIO,
    hauQua: 'Đơn mới không về hệ thống' },
  { key: 'sync-lark', ten: 'Đồng bộ Lark', chuKyPhut: 1 * GIO,
    hauQua: 'Bảng Lark lệch với hệ thống' },
  { key: 'sync-lifecycle', ten: 'Đồng bộ vòng đời đơn', chuKyPhut: 6 * GIO,
    hauQua: 'Bảng theo dõi tiến độ đơn đứng im' },
  { key: 'sync-warehouse', ten: 'Đối soát tồn kho Lark', chuKyPhut: 1 * NGAY,
    hauQua: 'Tồn kho lệch giữa Lark và hệ thống' },
  { key: 'sync-meanblvd', ten: 'Đẩy tồn kho lên Shopify MEAN BLVD', chuKyPhut: 1 * NGAY,
    hauQua: 'Shopify bán hàng đã hết tồn' },
  { key: 'sync-catalog', ten: 'Đồng bộ catalog Shopify', chuKyPhut: 1 * NGAY,
    hauQua: 'Sản phẩm mới/đổi tên không về hệ thống' },
  { key: 'sync-geo', ten: 'Làm mới dữ liệu địa lý', chuKyPhut: 30 * NGAY,
    hauQua: 'Danh mục tỉnh/thành cũ' },
  { key: 'create-sale', ten: 'Tạo sản phẩm -Sale', chuKyPhut: 1 * NGAY,
    hauQua: 'Hàng hoàn không lên sàn bán lại được' },
  { key: 'track-shipments', ten: 'Tra trạng thái giao (đơn hàng nhà)', chuKyPhut: 6 * GIO,
    hauQua: 'Không biết đơn đã giao hay chưa' },
  { key: 'track-ship-ho', ten: 'Tra trạng thái giao (ship hộ)', chuKyPhut: 6 * GIO,
    hauQua: 'Đối tác không thấy đơn đã giao' },
  { key: 'refresh-fuel', ten: 'Cập nhật phụ phí xăng dầu', chuKyPhut: 1 * NGAY,
    hauQua: 'Báo giá dùng mức xăng dầu tuần cũ' },
  { key: 'refresh-demand', ten: 'Cập nhật phụ phí demand FedEx', chuKyPhut: 7 * NGAY,
    hauQua: 'Thiếu phụ phí demand kỳ mới → tính thiếu cước' },
  { key: 'refresh-surcharges', ten: 'Cập nhật phụ phí hãng', chuKyPhut: 1 * NGAY,
    hauQua: 'Bảng phụ phí lạc hậu' },
  { key: 'refresh-vcb-fx', ten: 'Cập nhật tỉ giá Vietcombank', chuKyPhut: 1 * NGAY,
    hauQua: 'Quy đổi USD của Aramex sai tỉ giá' },
  { key: 'remind-fuel', ten: 'Nhắc nhập xăng dầu thủ công', chuKyPhut: 7 * NGAY,
    hauQua: 'Quên nhập mức xăng dầu cho UPS/SF' },
  { key: 'retry-mmp-orders', ten: 'Đẩy đơn sang MMP', chuKyPhut: 1 * GIO,
    hauQua: 'MMP không nhận được đơn mới → đối soát công nợ brand thiếu đơn' },
  { key: 'retry-ship-ho-events', ten: 'Gửi lại sự kiện MMP còn kẹt', chuKyPhut: 15 * PHUT,
    hauQua: 'Sự kiện hỏng nằm kẹt vĩnh viễn, MMP không nhận được' },
  { key: 'prune-logs', ten: 'Dọn bảng log', chuKyPhut: 7 * NGAY,
    hauQua: 'Database phình tới trần dung lượng' },
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
  if (lanCuoi.status === 'running') return 'dang_chay';
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
