/**
 * THUẦN: tính DÒNG ĐIỀU CHỈNH cho một bảng kê đã phát hành (CEO 01/10/2026).
 *
 * Điều chỉnh = HIỆU giữa ảnh chụp lúc phát hành và số hiện tại. Ba loại hiệu, và phải phân
 * biệt vì chúng là ba chuyện kế toán khác nhau:
 *   - `sua`   : đơn vẫn trong kê, giá đổi (hoá đơn hãng về muộn, duty về muộn, chốt lại);
 *   - `them`  : đơn mới thuộc kỳ đã khoá — thu thêm;
 *   - `bo`    : đơn bị gỡ khỏi kỳ (không gửi hàng, huỷ) — trả lại brand TOÀN BỘ số đã thu.
 *
 * Gộp ba loại thành "chênh lệch" là mất đúng phần brand cần để đối chiếu: một đơn giảm 100k
 * khác hẳn một đơn bị bỏ hẳn 100k, dù delta bằng nhau.
 */

/** Một dòng trong ảnh chụp lúc phát hành — đúng hình dạng payload đã gửi MMP. */
export interface DongAnhChup { code: string; amountVnd: number }

export type LoaiDieuChinh = 'sua' | 'them' | 'bo';

export interface DongDieuChinh {
  code: string;
  loai: LoaiDieuChinh;
  /** Số đã gửi brand (0 với `them`). */
  truoc: number;
  /** Số đúng bây giờ (0 với `bo`). */
  sau: number;
  /** `sau - truoc`. Âm = trả lại brand. */
  delta: number;
}

export interface KetQuaDieuChinh {
  dong: DongDieuChinh[];
  /** Tổng delta. Âm = brand được trả lại. */
  tongDelta: number;
}

const lamTron = (n: number) => Math.round(n);

/**
 * So ảnh chụp với hiện tại. Trả về MỌI dòng có hiệu, bỏ dòng không đổi.
 *
 * Làm tròn trước khi so: ảnh chụp lưu số đã làm tròn (payload gửi MMP dùng `Math.round`), còn
 * giá hiện tại là `numeric` có phần thập phân. So thẳng thì mỗi đơn lệch vài hào và CẢ KỲ biến
 * thành điều chỉnh — một bảng kê 75 dòng toàn rác, không ai đọc nữa.
 */
export function tinhDongDieuChinh(
  anhChup: readonly DongAnhChup[],
  hienTai: readonly DongAnhChup[],
): KetQuaDieuChinh {
  const cu = new Map(anhChup.map((d) => [d.code, lamTron(d.amountVnd)]));
  const moi = new Map(hienTai.map((d) => [d.code, lamTron(d.amountVnd)]));
  const dong: DongDieuChinh[] = [];

  for (const [code, truoc] of cu) {
    if (!moi.has(code)) { dong.push({ code, loai: 'bo', truoc, sau: 0, delta: -truoc }); continue; }
    const sau = moi.get(code)!;
    if (sau !== truoc) dong.push({ code, loai: 'sua', truoc, sau, delta: sau - truoc });
  }
  for (const [code, sau] of moi) {
    if (!cu.has(code)) dong.push({ code, loai: 'them', truoc: 0, sau, delta: sau });
  }

  // Thứ tự ổn định theo mã đơn: bảng kê điều chỉnh gửi brand hai lần phải ra cùng một thứ tự,
  // không phụ thuộc thứ tự Map trả về.
  dong.sort((a, b) => a.code.localeCompare(b.code));
  return { dong, tongDelta: dong.reduce((s, d) => s + d.delta, 0) };
}

/** Ảnh chụp đọc từ `lines_json`; trả `null` khi bảng kê chưa có ảnh chụp (phát hành trước 0190). */
export function docAnhChup(tho: unknown): DongAnhChup[] | null {
  if (tho == null) return null;
  const o = tho as { orders?: unknown };
  const ds = Array.isArray(o.orders) ? o.orders : Array.isArray(tho) ? tho : null;
  if (!ds) return null;
  const ra: DongAnhChup[] = [];
  for (const x of ds) {
    const d = x as { code?: unknown; amountVnd?: unknown };
    if (typeof d.code !== 'string' || typeof d.amountVnd !== 'number') continue;
    ra.push({ code: d.code, amountVnd: d.amountVnd });
  }
  return ra;
}

/**
 * Đọc dòng điều chỉnh từ `lines_json` của một bảng kê `adjustment`.
 *
 * Trả `null` khi không đọc được — người gọi phải KHÔNG GỬI, chứ không gửi rỗng: một bảng kê
 * điều chỉnh rỗng làm MMP xoá sạch dòng điều chỉnh bên họ.
 */
export function docDongDieuChinh(tho: unknown): DongDieuChinh[] | null {
  if (tho == null) return null;
  const o = tho as { dong?: unknown };
  const ds = Array.isArray(o.dong) ? o.dong : Array.isArray(tho) ? tho : null;
  if (!ds) return null;
  const ra: DongDieuChinh[] = [];
  for (const x of ds) {
    const d = x as { code?: unknown; loai?: unknown; truoc?: unknown; sau?: unknown; delta?: unknown };
    if (typeof d.code !== 'string') continue;
    if (d.loai !== 'sua' && d.loai !== 'them' && d.loai !== 'bo') continue;
    if (typeof d.truoc !== 'number' || typeof d.sau !== 'number' || typeof d.delta !== 'number') continue;
    ra.push({ code: d.code, loai: d.loai, truoc: d.truoc, sau: d.sau, delta: d.delta });
  }
  return ra;
}
