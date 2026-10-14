export interface BaChieu {
  daiCm: number;
  rongCm: number;
  caoCm: number | null;
}

/**
 * THUẦN: Đọc chuỗi kích thước tự do thành cấu trúc ba chiều chuẩn hoá.
 * Chỉ chấp nhận 2 hoặc 3 số dương; các trường hợp khác (quá 3 số, số 0, số âm) trả null.
 * Cao cm: nếu có 3 số thì lấy, nếu chỉ có 2 số thì null (không phải 0).
 *
 * @param raw - Chuỗi định dạng "DxRxC" hoặc "DxR" (có thể chứa khoảng trắng, X/× thay x)
 * @returns Cấu trúc BaChieu hoặc null nếu không hợp lệ
 */
export function docKichThuoc(raw: string | null | undefined): BaChieu | null {
  if (!raw) return null;

  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  // Tách theo x/X/× (không phân biệt hoa/thường), trim từng phần
  const parts = trimmed.toLowerCase().split(/[x×]/).map((p) => Number(p.trim()));

  // Phải có ít nhất 2 số, không được quá 3
  if (parts.length < 2 || parts.length > 3) return null;

  // Hai số đầu tiên PHẢI là số dương hữu hạn (không 0, không âm)
  if (parts.some((n, i) => i < 2 && (!Number.isFinite(n) || n <= 0))) return null;

  const [daiCm, rongCm, cao] = parts;

  // Cao cm: nếu có (là phần tử thứ 3) thì lấy giá trị nếu nó > 0, ngược lại null
  const caoCm = Number.isFinite(cao) && cao > 0 ? cao : null;

  return { daiCm, rongCm, caoCm };
}
