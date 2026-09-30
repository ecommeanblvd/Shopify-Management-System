/**
 * THUẦN: xếp loại MỘT TUYẾN (hoặc một hãng trên tuyến) so với ngưỡng của kỳ.
 *
 * Vì sao cần (CEO 30/09/2026): bảng 1.2 theo tuyến hiện tỉ lệ đúng hạn nhưng KHÔNG đặt ngưỡng
 * cạnh con số, nên người đọc phải tự nhớ "ngưỡng kỳ này là bao nhiêu" rồi nhẩm so từng dòng.
 * Nặng hơn: các dòng HÃNG con trước nay không được tô màu gì cả, nên UPS 11,1% trông y hệt
 * FedEx 85,5%. Một tuyến hỏng nặng mà nhìn như tuyến bình thường thì bảng thôi cảnh báo.
 *
 * KHÔNG có ngưỡng riêng theo nước: quy chế chỉ có MỘT ngưỡng cho cả kỳ (`nguongDatKy`), siết dần
 * theo lộ trình — 65% tới hết Q4/2026, 85% từ Q1/2027, 90% từ Q3/2027. Cam kết theo nước là số
 * NGÀY giao, không phải tỉ lệ.
 */
import { NGUONG_HIEN_TUYEN } from '@/features/shipments/sop-giao-hang';

export type MaXepLoaiTuyen = 'dat' | 'chua_dat' | 'it_kien' | 'chua_do';

export interface XepLoaiTuyen {
  ma: MaXepLoaiTuyen;
  nhan: string;
  /** Số ĐIỂM PHẦN TRĂM còn thiếu so với ngưỡng; null khi không phải ca thiếu. */
  thieuDiem: number | null;
}

/**
 * Xếp loại một dòng tuyến.
 *
 * Dòng ÍT KIỆN không được gọi là đạt hay trượt. Ngưỡng hiển thị tuyến là 10 kiện (`NGUONG_HIEN_TUYEN`)
 * — chính SOP cũng lấy mốc đó mới đặt cam kết riêng cho một nước. Dưới mức ấy, một kiện trễ đã
 * đổi tỉ lệ cả chục điểm, nên kết luận "tuyến này hỏng" là kết luận trên nhiễu.
 */
export function xepLoaiTuyen(
  tyLeDungHan: number | null,
  soKien: number,
  nguongKy: number,
  nguongDuKien = NGUONG_HIEN_TUYEN,
): XepLoaiTuyen {
  if (tyLeDungHan == null || soKien <= 0) return { ma: 'chua_do', nhan: 'Chưa có kiện', thieuDiem: null };
  if (soKien < nguongDuKien) {
    return { ma: 'it_kien', nhan: `Chưa đủ kiện để kết luận (<${nguongDuKien})`, thieuDiem: null };
  }
  if (tyLeDungHan >= nguongKy) return { ma: 'dat', nhan: 'Đạt', thieuDiem: null };
  // Làm tròn 1 chữ số cho khớp với cách bảng hiển thị tỉ lệ; tránh "thiếu 0.8000000001 điểm".
  const thieu = Math.round((nguongKy - tyLeDungHan) * 1000) / 10;
  return { ma: 'chua_dat', nhan: `Thiếu ${thieu} điểm`, thieuDiem: thieu };
}

/** Màu chữ theo xếp loại. Dòng ít kiện để XÁM — không được nhuộm đỏ cho một kết luận chưa đủ căn cứ. */
export const MAU_XEP_LOAI: Record<MaXepLoaiTuyen, string> = {
  dat: 'text-emerald-600 dark:text-emerald-400',
  chua_dat: 'text-red-600 dark:text-red-400',
  it_kien: 'text-muted-foreground',
  chua_do: 'text-muted-foreground',
};
