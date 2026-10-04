/**
 * THUẦN: chuỗi vendor lấy từ gói sản phẩm MMP (MMP chốt 04/10/2026).
 *
 * MMP là bên CHỌN tên vendor cho sản phẩm trên Shopify; SMS chỉ nhận và giữ nguyên văn —
 * không đổi hoa thường, không bỏ dấu, không chuẩn hoá theo `normalizeBrandDisplayName`. Chuẩn
 * hoá hộ là tự ý sửa thứ bên kia đã quyết, rồi hai hệ thống hiểu khác nhau về cùng một brand.
 *
 * Trả `null` nghĩa là "gói KHÔNG nói gì về vendor" — người gọi phải GIỮ NGUYÊN giá trị đang có,
 * không ghi đè thành rỗng (MMP chốt: "nếu gói không có trường vendor thì giữ nguyên vendor đang
 * có trên Shopify, không ghi rỗng").
 *
 * Chuỗi chỉ có khoảng trắng cũng trả `null`: nó không phải một quyết định, chỉ là ô bỏ trống.
 * Nếu MMP muốn XOÁ vendor thì đó là một yêu cầu khác, cần một cách nói rõ ràng hơn chuỗi rỗng.
 */
export function vendorTuGoi(v: string | null | undefined): string | null {
  if (typeof v !== 'string') return null;
  // CHỈ cắt khoảng trắng hai đầu — bên trong giữ nguyên, kể cả hai dấu cách liền nhau.
  const s = v.trim();
  return s === '' ? null : s;
}
