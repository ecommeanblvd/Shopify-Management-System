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
  { key: 'ship-ho-reconcile', ten: 'Đối soát ship hộ từ hoá đơn', chuKyPhut: 1 * GIO,
    hauQua: 'Đơn ship hộ không được tính lại giá theo cân thực' },
  { key: 'retry-mmp-orders', ten: 'Đẩy đơn sang MMP', chuKyPhut: 1 * GIO,
    hauQua: 'MMP không nhận được đơn mới → đối soát công nợ brand thiếu đơn' },
  { key: 'retry-ship-ho-events', ten: 'Gửi lại sự kiện MMP còn kẹt', chuKyPhut: 15 * PHUT,
    hauQua: 'Sự kiện hỏng nằm kẹt vĩnh viễn, MMP không nhận được' },
  { key: 'push-nhan-hang', ten: 'Đẩy "MEAN đã nhận" + Mã món lên Lark', chuKyPhut: CHU_KY_SYNC_LARK,
    hauQua: 'QC/đóng gói trên Lark không thấy món đã về, MMP thiếu ngày nhận' },
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
