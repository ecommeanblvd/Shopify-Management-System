/**
 * Ngày đi hàng (shipped_at) của đơn ship hộ — logic THUẦN (test được).
 *
 * Quy tắc (chốt 22/07): staff nhập tracking → mặc định ngày đi hàng = ngày nhập
 * tracking lên hệ thống (hôm nay, giờ VN); Logistic staff sửa được vì có thể tạo
 * tracking trước, đi hàng chậm hơn 1-2 ngày. Bill carrier về có ship_date thì
 * ship_date của bill vẫn thắng khi tính fuel (xem reconcile-actions).
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Hôm nay theo giờ VN dạng 'YYYY-MM-DD' — ngày nghiệp vụ của ops. */
export function vnToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(now);
}

/** 'YYYY-MM-DD' hợp lệ và là ngày có thật (2026-02-30 → false). */
export function isValidDateStr(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * Ngày đi hàng sau khi gán/sửa tracking.
 * - `input` (staff chọn trong modal) → dùng nếu hợp lệ, sai định dạng → lỗi.
 * - Không nhập → giữ ngày đã có; đơn chưa có → mặc định hôm nay (giờ VN).
 */
export function resolveShippedAt(
  current: string | null,
  input: string | null | undefined,
  now: Date = new Date(),
): { ok: true; value: string } | { ok: false; error: string } {
  if (input != null && input !== '') {
    if (!isValidDateStr(input)) return { ok: false, error: 'Ngày đi hàng không hợp lệ (YYYY-MM-DD)' };
    return { ok: true, value: input };
  }
  return { ok: true, value: current ?? vnToday(now) };
}
