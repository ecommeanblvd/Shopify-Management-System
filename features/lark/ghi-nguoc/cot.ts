/**
 * Tên cột bảng Lark LOG-Export mà SMS ghi ngược (spec 2026-09-19 §5). Đổi tên cột bên Lark là
 * hỏng — nên để MỘT chỗ. Hai ô chọn kèm danh sách giá trị hợp lệ kiểm 19/09/2026 qua API fields:
 * ghi chuỗi lạ vào ô chọn là Lark đẻ lựa chọn mới (bài học cột Couriers, D-045).
 */
export const COT = {
  logUniqueCode: 'Log Unique code',
  category: 'LOG-EP-Dispatch Category (Final)',
  status: 'LOG-EP-Dispatch Status',
  ngayGiaoThucTe: 'Ngày giao thực tế',
  ngayGiaoDuKien: 'Ngày giao dự kiến',
  /** Khớp đúng tên field Lark mà `parse-pack-row.ts` đang đọc (`fields['Tracking Number']`) —
   *  dùng khoá có sẵn thay vì bịa tên mới, tránh hai chỗ trỏ vào hai cột khác nhau. */
  trackingNumber: 'Tracking Number',
} as const;

export const LUA_CHON_CATEGORY: readonly string[] = [
  'Shipment Created', 'In Transit', 'Shipping Exceptions', 'Delivered', 'Lost by Carrier', 'Shipping Failed',
];
export const LUA_CHON_STATUS: readonly string[] = [
  'Ready for Carrier', 'On Delivery', 'Delayed', 'Customs Clearance', 'Forward to Third-party',
  'Hold by Unavoidable Reason', 'Delivery Attempt Failed', 'Additional Information Required', 'Held for Pickup',
  'Delivery Completed', 'Return-Processing', 'Package Lost', 'On Hold', 'Cancel at Cnee Country',
];

/** Khoá `shipment_charges` → cột tiền trên Lark (VND). `discount` không ghi: Lark có công thức
 *  "Giá chiết khấu". `address_correction`, `non_conveyable` không có cột.
 *
 *  `as const` chứ KHÔNG `Record<string, string>`: kiểu rộng cho phép tra một khoá không tồn tại
 *  mà vẫn qua được type-check, nên đổi tên một khoá ở đây sẽ gửi `patch["undefined"]` lên Lark
 *  (tên cột rỗng ⇒ PUT là all-or-nothing nên chặn cả bản vá). Khoá hẹp bắt lỗi đó lúc biên dịch. */
export const COT_CHI_PHI = {
  totalAmount: 'INS | Chi phí Tổng (đ)',
  base: 'Mức giá cơ sở',
  fuel: 'Phụ phí nhiên liệu',
  remote: 'Phụ phí vùng sâu xa',
  demand: 'EES / Theo nhu cầu',
  directSignature: 'Phí kí nhận trực tiếp',
  vat: 'VAT/Thuế phí khác',
  gogreen: 'GoGreen Plus-Basic',
  elevatedRisk: 'Phí rủi ro gia tăng',
  importHandling: 'Phí xử lý hàng nhập',
  residential: 'Phụ Phí Residential',
} as const;

/** Khoá hợp lệ của `COT_CHI_PHI` — dùng để bảng map khoản→cột của nơi khác được type-check. */
export type KhoaCotChiPhi = keyof typeof COT_CHI_PHI;
