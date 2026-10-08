/**
 * THUẦN: dựng hàng ghi lên sheet đối soát. Không I/O.
 *
 * Ngày là SỐ serial — cột không có định dạng ngày thì serial hiện ra như 46209, nên `day-sheet`
 * đặt định dạng TRƯỚC khi ghi. Sheet Kalisa từng có 34 ô ngày lưu thành văn bản.
 *
 * TIỀN là SỐ, không phải chuỗi (CEO 08/10/2026: "để số number thôi, còn format cột đó thành
 * currency VNĐ để có thể tính toán được"). Bản đầu ghi chuỗi `"996.240 đ"` cho giống y hệt ô
 * thật trên sheet cũ — giống về mắt nhưng brand không cộng được cột nào, và dòng TỔNG cũng
 * không dựng được. Định dạng tiền do `day-sheet` đặt ở cấp cột.
 *
 * PHẦN TRĂM vẫn là chuỗi `"38,25%"`: nó không nằm trong phép cộng nào, và đổi sang số thì phải
 * lưu dạng phân số (0,3825) — một lần đọc nhầm là sai 100 lần.
 */
import { serialNgay } from '@/lib/google/sheets';

export const COT_SHEET = [
  'STT', 'Mã đơn', 'Mã tracking', 'Couriers', 'Ngày gửi', 'Cân nặng tính cước', 'Quốc gia',
  'Cước vận chuyển', '% PP Nhiên liệu', 'PP Nhiên liệu', 'PP kí nhận trực tiếp', 'PP Nhu cầu',
  'PP vùng sâu xa', 'Phí Giao nhà dân', 'PP xử lý hàng nhập', 'PP Address Correction',
  'Phụ phí khác', 'VAT (8%)', 'PP Xử lý hàng hóa', 'Tổng thu', 'Mã SMS',
] as const;

export interface DonSheet {
  stt: number; maBrand: string; tracking: string; hang: string;
  ngayDi: string | null; canKg: number; nuoc: string;
  cuoc: number; pctFuel: number | null; fuel: number; kyNhan: number; nhuCau: number;
  vungXa: number; nhaDan: number; xuLyNhap: number; suaDiaChi: number; phuPhiKhac: number;
  vat: number; xuLyDon: number; tongThu: number; maSms: string;
}

const tien = (n: number) => Math.round(n);

/** Chỉ số (0-based) các cột TIỀN của bảng cước — `day-sheet` dùng để đặt định dạng và dựng TỔNG. */
export const COT_TIEN = [7, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19] as const;
/** Cột tiền của bảng thuế: chỉ "Duty/Tax (Nước tới)". */
export const COT_TIEN_DUTY = [6] as const;

/**
 * THUẦN: vị trí tab MỚI trong sổ, để sheet luôn xếp theo kỳ và trong một kỳ thì CƯỚC trước,
 * THUẾ sau (CEO 08/10/2026).
 *
 * Vì sao cần: lệnh đẩy sheet tạo tab bằng `addSheet` và Google xếp tab mới vào CUỐI sổ. Kỳ
 * tháng 10 phát hành bảng thuế trước bảng cước thì sổ ra thứ tự "10.26 Duty" rồi mới "10.26" —
 * brand mở sheet thấy bảng thuế đứng trước bảng cước của cùng tháng.
 *
 * Tab KHÔNG đọc được tên kỳ (vd "Ghi chú") giữ nguyên chỗ: chen tab kỳ vào giữa chúng là tự
 * sắp xếp lại sổ của brand, việc không ai nhờ.
 */
export function viTriTabMoi(tenHienCo: readonly string[], tenMoi: string): number {
  const khoa = (t: string): number | null => {
    const m = /^(\d{1,2})\.(\d{2})( Duty)?$/.exec(t.trim());
    if (!m) return null;
    const thang = Number(m[1]), nam = Number(m[2]), duty = m[3] ? 1 : 0;
    if (!(thang >= 1 && thang <= 12)) return null;
    return nam * 100 + thang * 2 + duty;   // năm → tháng → cước trước thuế
  };
  const k = khoa(tenMoi);
  if (k == null) return tenHienCo.length;
  for (let i = 0; i < tenHienCo.length; i++) {
    const ki = khoa(tenHienCo[i]!);
    if (ki != null && ki > k) return i;
  }
  return tenHienCo.length;
}

/** Chữ cột kiểu A1 từ chỉ số 0-based: 0→A, 25→Z, 26→AA. */
export function chuCot(i: number): string {
  let s = '', k = i;
  do { s = String.fromCharCode(65 + (k % 26)) + s; k = Math.floor(k / 26) - 1; } while (k >= 0);
  return s;
}

/**
 * THUẦN: dòng TỔNG cuối bảng. Ô tiền là CÔNG THỨC `=SUM(...)`, không phải số tính sẵn.
 *
 * Vì sao công thức: brand sửa/lọc một dòng thì tổng phải đổi theo. Một con số tính sẵn sẽ đứng
 * yên và nói dối ngay lần đầu ai đó đụng vào bảng.
 *
 * `soDong` = số dòng DỮ LIỆU; dữ liệu bắt đầu ở hàng 2 vì hàng 1 là tiêu đề.
 */
export function dongTong(soCot: number, cotTien: readonly number[], soDong: number): (string | number)[] {
  const ra: (string | number)[] = Array.from({ length: soCot }, () => '');
  /* Chữ "Tổng" ở cột B (Mã đơn), KHÔNG phải cột A — đọc từ chính tab 7.26 và 8.26 của sheet
   * Kalisa ngày 08/10/2026. Cột A để trống. Theo nếp sẵn có thay vì đặt nếp mới: brand đã quen
   * mắt với bố cục đó suốt mấy kỳ. */
  ra[1] = 'Tổng';
  if (soDong <= 0) return ra;
  for (const c of cotTien) {
    const ch = chuCot(c);
    ra[c] = `=SUM(${ch}2:${ch}${soDong + 1})`;
  }
  return ra;
}
const pct = (n: number | null) =>
  n == null ? '' : `${n.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

export function hangSheet(don: readonly DonSheet[]): (string | number)[][] {
  return don.map((d) => [
    d.stt, d.maBrand, d.tracking, d.hang, d.ngayDi ? serialNgay(d.ngayDi) : '', d.canKg, d.nuoc,
    tien(d.cuoc), pct(d.pctFuel), tien(d.fuel), tien(d.kyNhan), tien(d.nhuCau), tien(d.vungXa),
    tien(d.nhaDan), tien(d.xuLyNhap), tien(d.suaDiaChi), tien(d.phuPhiKhac), tien(d.vat),
    tien(d.xuLyDon), tien(d.tongThu), d.maSms,
  ]);
}

/* ── Bảng kê THUẾ / PHÍ NHẬP KHẨU ──
 *
 * Tab riêng, tên có hậu tố " Duty" — đúng nếp sheet Kalisa đang dùng (`8.26` và `8.26 Duty`).
 * Bản đầu đặt tên tab chỉ theo tháng nên hai bảng kê cùng kỳ GHI ĐÈ nhau, phát hiện 03/10/2026
 * khi gắn sheet cho lekieu và tom-fried.
 *
 * Bố cục 8 cột, đọc từ chính tab `8.26 Duty` của Kalisa — ít cột hơn hẳn bảng cước vì thuế là
 * khoản THU HỘ nguyên giá: không markup, không nhiên liệu, không VAT.
 */
export const COT_SHEET_DUTY = [
  'STT', 'Mã đơn', 'Mã tracking', 'Ngày gửi', 'Quốc gia', 'Số hoá đơn FedEx',
  'Duty/Tax (Nước tới)', 'Mã SMS',
] as const;

export interface DonSheetDuty {
  stt: number; maBrand: string; tracking: string; ngayDi: string | null; nuoc: string;
  soHoaDon: string; duty: number; maSms: string;
}

export function hangSheetDuty(don: readonly DonSheetDuty[]): (string | number)[][] {
  return don.map((d) => [
    d.stt, d.maBrand, d.tracking, d.ngayDi ? serialNgay(d.ngayDi) : '', d.nuoc,
    d.soHoaDon, tien(d.duty), d.maSms,
  ]);
}
