/**
 * THUẦN: mức phụ phí xăng dầu hãng công bố cho tuần chứa một ngày. Không I/O.
 *
 * Khoảng tuần là NỬA MỞ `[tu, den)`: hãng đổi mức vào thứ Hai, nên ngày `den` đã thuộc tuần
 * sau. Lấy nhầm biên là sai đúng một tuần, mà hai tuần liền kề thường chênh nhau 0,25–1,5%.
 */
export interface TuanFuel {
  tu: string;
  /** `null` = tuần đang mở. */
  den: string | null;
  pct: number;
}

export function pctTuanCuaNgay(tuan: readonly TuanFuel[], ngay: string): number | null {
  const w = tuan.find((x) => ngay >= x.tu && (x.den === null || ngay < x.den));
  return w ? w.pct : null;
}
