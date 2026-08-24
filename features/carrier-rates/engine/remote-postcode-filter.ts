/**
 * Chuẩn hoá danh sách mã bưu chính dùng để LỌC bảng ODA khi nạp snapshot.
 *
 * Vì sao cần: bảng carrier_remote_postcodes có 1.033.986 dòng và **không dòng
 * nào chứa ký tự đại diện** — toàn bộ là mã bưu chính chính xác. Nghĩa là khi
 * đã biết mã của đơn (checkout, đối soát, quote ship hộ), không có lý do gì
 * phải kéo cả nước về: nạp riêng nước US thôi cũng đã 112.589 dòng mỗi lượt.
 * Đây chính là nguồn egress đã làm Supabase khoá dịch vụ ngày 24/08 (D-025).
 *
 * Trả về hai dạng vì file của hãng và địa chỉ khách nhập không thống nhất cách
 * ngăn cách: hãng ghi '5000-289' còn khách gõ '5000289'. Bên gọi so khớp cả
 * dạng gốc lẫn dạng đã bỏ ký tự ngăn cách để không trượt mất dòng ODA.
 *
 * Danh sách rút gọn còn kèm TIỀN TỐ trước dấu ngăn cách, vì engine
 * (remote-match.ts) tra theo thứ tự gốc → rút gọn → tiền tố: địa chỉ Mỹ gửi
 * ZIP+4 '98077-5629' trong khi hãng chỉ lưu '98077'.
 *
 * LƯU Ý cho bên gọi: bảng ODA còn ~24.000 dòng ghi TÊN THÀNH PHỐ thay vì mã
 * bưu chính (NZ, AR, NG…), và engine khớp chúng qua `destinationCity`. Lọc
 * theo mã bưu chính thôi sẽ bỏ sót các dòng đó, nên truy vấn phải luôn lấy
 * kèm những dòng không chứa chữ số.
 */
export type DanhSachPostcode = {
  /** Viết hoa, cắt khoảng trắng hai đầu — so thẳng với cột postcode_pattern. */
  goc: string[];
  /** Chỉ còn chữ và số — so với postcode_pattern đã rút gọn tương ứng. */
  rutGon: string[];
};

export function chuanHoaDanhSachPostcode(
  list: readonly (string | null | undefined)[],
): DanhSachPostcode {
  const goc = new Set<string>();
  const rutGon = new Set<string>();
  for (const raw of list) {
    const s = (raw ?? '').trim().toUpperCase();
    if (!s) continue;
    goc.add(s);
    const gon = s.replace(/[^A-Z0-9]/g, '');
    if (gon) rutGon.add(gon);
    const tienTo = s.split(/[-\s]/)[0]?.replace(/[^A-Z0-9]/g, '') ?? '';
    if (tienTo) rutGon.add(tienTo);
  }
  return { goc: [...goc], rutGon: [...rutGon] };
}
