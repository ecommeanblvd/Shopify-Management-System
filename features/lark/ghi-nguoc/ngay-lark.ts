/**
 * THUẦN: ngày dạng Lark cho ghi ngược (spec §5.2). Lark lưu ô ngày là epoch ms; bảng LOG-Export
 * dùng epoch của NỬA ĐÊM GIỜ VN (đọc vào bằng `larkEpochToVnMidnight`). Đây là chiều ngược lại.
 */
import { larkDateField } from '../parse-brand-received';
import { slaCuaNuoc } from '@/features/shipments/sop-giao-hang';

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const NGAY_MS = 24 * 60 * 60 * 1000;

/** Epoch ms của nửa đêm giờ VN thuộc ngày-lịch VN chứa mốc `d`. */
export function ngayLark(d: Date): number {
  const vn = new Date(d.getTime() + VN_OFFSET_MS);
  return Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate()) - VN_OFFSET_MS;
}

/** Ô ngày trên Lark → epoch ms; trống/lạ → null. */
export function docNgayLark(v: unknown): number | null {
  return larkDateField(v);
}

/** Cam kết SOP: ngày tạo nhãn + số ngày cam kết của nước (cùng bảng KPI 1.2 dùng). */
export function ngayDuKien(labelCreatedAt: Date, shipCountry: string): number {
  return ngayLark(new Date(labelCreatedAt.getTime() + slaCuaNuoc(shipCountry) * NGAY_MS));
}
