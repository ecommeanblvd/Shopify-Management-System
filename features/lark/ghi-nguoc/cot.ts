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

/** Khoá `shipment_charges` → cột tiền trên Lark (VND). `address_correction`, `non_conveyable`
 *  không có cột.
 *
 *  Ô `Giá chiết khấu` KHÔNG BAO GIỜ được ghi — đó là **Formula của Lark** (đọc API fields
 *  13/10/2026: `fldlEbi91K` type=20), nó tự tính `Tổng − base − fuel − ký nhận − …`. Số chiết
 *  khấu đi vào ô RIÊNG `Chiết khấu || API` (xem dưới); hai ô khác nhau, đừng lẫn.
 *
 *  `as const` chứ KHÔNG `Record<string, string>`: kiểu rộng cho phép tra một khoá không tồn tại
 *  mà vẫn qua được type-check, nên đổi tên một khoá ở đây sẽ gửi `patch["undefined"]` lên Lark
 *  (tên cột rỗng ⇒ PUT là all-or-nothing nên chặn cả bản vá). Khoá hẹp bắt lỗi đó lúc biên dịch. */
export const COT_CHI_PHI = {
  totalAmount: 'INS | Chi phí Tổng (đ)',
  /** Giá **GỐC**, CHƯA trừ chiết khấu (CEO chốt 13/10/2026, D-245 bản 2). Vòng sửa trước đặt ô
   *  này là giá net và đã bị xoá: ô `Giá chiết khấu` là Formula của Lark tính
   *  `Tổng − base − fuel − ký nhận − …`, nên bảng vốn chờ base GỐC — đưa base net vào là làm
   *  công thức đó ra một số chiết khấu vô nghĩa. Đo 4.591 bản ghi: 2.878 dòng gõ base > tổng
   *  (gốc — ĐÚNG) vs 1.251 dòng gõ net. Số chiết khấu đi vào `discountApi` dưới đây. */
  base: 'Mức giá cơ sở',
  /**
   * ⚠️ TÊN CỘT CÓ **HAI** DẤU GẠCH ĐỨNG, mỗi bên một khoảng trắng: `Chiết khấu || API`.
   * Đọc nguyên văn từ API fields 13/10/2026 (`fldY1E45DQ`, type=2 — ô số, GHI ĐƯỢC). Dễ bị ai
   * dọn bảng sửa thành một gạch (`Chiết khấu | API`, cho giống `INS | Chi phí Tổng (đ)`) — mà
   * Lark ghi theo TÊN cột và PUT là all-or-nothing, nên lệch một ký tự là **cả bản vá bị từ
   * chối**, kể cả những ô chẳng liên quan. Lỗi lúc đó hiện ra ở `ghi-gia-uoc-tinh-len-lark.ts`
   * kèm `code=`/`msg=` của Lark và danh sách cột đã gửi — đó là chỗ bắt đầu truy.
   *
   * Khoá CỐ Ý không trùng tên cột nào của `shipment_charges`: vòng lặp
   * `Object.entries(COT_CHI_PHI)` trong `dung-patch.ts` tra `khoan[khoa]` nên khoá lạ ra
   * `undefined` ⇒ đường ghi từ HOÁ ĐƠN bỏ qua ô này. Đúng ý muốn — ô tên "|| API" dành cho số
   * API báo giá trả về; chiết khấu hoá đơn là số khác (và lưu dấu ÂM, đo 2.898/2.898 dòng).
   */
  discountApi: 'Chiết khấu || API',
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
