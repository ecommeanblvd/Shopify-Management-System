export interface BaChieu {
  daiCm: number;
  rongCm: number;
  caoCm: number | null;
}

/**
 * THUẦN: Đọc chuỗi kích thước tự do thành cấu trúc ba chiều chuẩn hoá.
 * Chỉ chấp nhận 2 hoặc 3 số dương; các trường hợp khác (quá 3 số, số 0, số âm) trả null.
 * Hiểu dấu thập phân chứa dấu phẩy (VN: "9,5") và dấu chấm (quốc tế: "9.5").
 *
 * Hai số: caoCm = null (hợp lệ, là kích thước túi 2D không có cao).
 * Ba số: caoCm phải > 0 — nếu là 0, âm, hay không phân tích được, trả null cho cả input.
 *        (Vì số 0 và âm là dữ liệu xấu từ kho, không phải "không có giá trị").
 *
 * @param raw - Chuỗi định dạng "DxRxC" hoặc "DxR" (có thể chứa khoảng trắng, X/× thay x, phẩy thập phân VN)
 * @returns Cấu trúc BaChieu hoặc null nếu không hợp lệ
 */
export function docKichThuoc(raw: string | null | undefined): BaChieu | null {
  if (!raw) return null;

  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  // Tách theo x/X/× (không phân biệt hoa/thường), trim và chuẩn hoá dấu thập phân
  const parts = trimmed
    .toLowerCase()
    .split(/[x×]/)
    .map((p) => Number(p.trim().replace(',', '.')));

  // Phải có ít nhất 2 số, không được quá 3
  if (parts.length < 2 || parts.length > 3) return null;

  // Hai số đầu tiên PHẢI là số dương hữu hạn (không 0, không âm)
  if (parts.some((n, i) => i < 2 && (!Number.isFinite(n) || n <= 0))) return null;

  const [daiCm, rongCm, cao] = parts;

  // Cao cm: nếu chỉ có 2 số thì null (hợp lệ — túi 2D)
  // Nếu có 3 số: phải > 0, nếu không (0, âm, hoặc không phân tích được) thì cả input null
  if (parts.length === 3) {
    if (!Number.isFinite(cao) || cao <= 0) return null;
    return { daiCm, rongCm, caoCm: cao };
  }

  return { daiCm, rongCm, caoCm: null };
}
