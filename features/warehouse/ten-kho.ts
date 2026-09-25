/**
 * Tên đầy đủ của ba kho (CEO 25/09).
 *
 * Mã kho `GVM`/`AP`/`DM` là thứ hệ thống lưu và đối soát — không đổi. Nhưng
 * người đứng ở kho bấm nút thì đọc tên địa điểm nhanh hơn đọc mã viết tắt, nên
 * MỌI chỗ cho người dùng chọn kho đều hiện tên, giữ mã trong ngoặc để còn khớp
 * với bảng biểu và Lark.
 */
export const TEN_KHO: Record<string, string> = {
  GVM: 'Giang Văn Minh',
  AP: 'An Phú',
  DM: 'Diamond Plaza',
};

/** "GVM" → "Giang Văn Minh (GVM)". Mã lạ thì trả nguyên mã, không bịa tên. */
export function nhanKho(ma: string): string {
  const ten = TEN_KHO[ma];
  return ten ? `${ten} (${ma})` : ma;
}
