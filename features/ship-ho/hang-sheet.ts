/**
 * THUẦN: dựng hàng ghi lên sheet đối soát. Không I/O.
 *
 * Thứ tự và kiểu dữ liệu lấy từ CHÍNH sheet Kalisa đang dùng (đọc ô thật 02/10/2026): tiền là
 * CHUỖI `"996.240 đ"`, phần trăm là chuỗi `"38,25%"`, còn ngày là SỐ serial. Ghi sai kiểu thì
 * cột mất định dạng, hoặc mất khả năng sắp xếp — sheet đó từng có 34 ô ngày lưu thành văn bản.
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

const tien = (n: number) => `${Math.round(n).toLocaleString('vi-VN')} đ`;
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
