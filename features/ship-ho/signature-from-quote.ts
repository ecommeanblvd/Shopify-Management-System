/**
 * Đơn ship hộ này có được báo giá kèm phí ký nhận không.
 *
 * Ship hộ khác hàng ta tự vận hành: MEAN BLVD / Mirer / Tinh luôn gửi kèm ký
 * nhận, còn ship hộ là lựa chọn của bên đối tác. Lựa chọn đó không lưu thành
 * cột riêng — nó nằm trong breakdown của báo giá đã chốt với brand, nên panel
 * so sánh line phải đọc lại từ đó để không lệch với thứ đã báo.
 *
 * Thiếu báo giá → false: ship hộ không auto thu, đoán "có" là tính dư cho brand.
 */
export function kyNhanTheoBaoGia(quoteBreakdown: unknown): boolean {
  const b = quoteBreakdown as { addons?: unknown } | null | undefined;
  return Number(b?.addons ?? 0) > 0;
}
