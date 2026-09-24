import { thangKinhDoanh } from '@/lib/timezone';
import { TIEN_TO_MA, type LoaiNguoiNhan } from './types';

/**
 * THUẦN: dựng mã đơn KOL từ số sequence.
 *
 * Sequence chạy LIÊN TỤC, cố ý không reset theo tháng: đơn cuối tháng 9 là
 * KOL-2609-0007 thì đơn đầu tháng 10 là KOL-2610-0008. Nhờ vậy mã không bao
 * giờ trùng kể cả khi ai đó sửa giờ hệ thống.
 *
 * Năm-tháng quy theo giờ kinh doanh (Asia/Bangkok), không UTC, để đơn tạo lúc
 * 00:30 ngày 1 tháng 10 VN được ghi tháng 10, không tháng 9.
 *
 * Tiền tố theo LOẠI NGƯỜI NHẬN (KOL-… / PH-…) — bản thiết kế 24/09. Sequence vẫn
 * dùng CHUNG một nguồn cho cả hai loại, cố ý: đổi loại người nhận về sau không
 * được phép sinh ra một mã đã tồn tại ở loại kia.
 */
export function maDonKol(soSeq: number, luc: Date, loai: LoaiNguoiNhan = 'kol'): string {
  // Kiểm tra soSeq phải là số nguyên dương
  if (!Number.isInteger(soSeq) || soSeq <= 0) {
    throw new Error(`Số thứ tự đơn phải là số nguyên dương, nhận được: ${soSeq}`);
  }

  // Lấy năm-tháng theo giờ kinh doanh: "2026-10"
  const thang = thangKinhDoanh(luc);
  if (!thang) {
    throw new Error(`Không thể lấy tháng kinh doanh từ: ${luc}`);
  }

  // Cắt lấy 2 chữ số cuối của năm (26) và 2 chữ số tháng (10): "2610"
  const namThang = thang.replace('-', '').slice(-4);

  return `${TIEN_TO_MA[loai]}-${namThang}-${String(soSeq).padStart(4, '0')}`;
}
