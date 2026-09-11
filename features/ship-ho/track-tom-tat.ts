/**
 * THUẦN: gom lý do hỏng của một lượt tra vận đơn ship hộ.
 *
 * Vì sao cần: `track-ship-ho` chạy 141 lượt, lượt nào cũng `failed: 46, tracked: 0`
 * mà nhật ký vẫn ghi "ok" — hỏng 100 % trong IM LẶNG suốt nhiều tháng, không ai
 * biết vì summary chỉ đếm số lỗi chứ không giữ lý do (phát hiện 11/09/2026).
 * Giữ lý do lại thì lần chạy sau là biết ngay hỏng vì đâu.
 */
export interface TomTatTrack {
  tracked: number;
  delivered: number;
  failed: number;
  skippedDhl: number;
  /** Lý do hỏng → số lần, nhiều nhất trước. Cắt bớt để summary không phình. */
  loi?: Record<string, number>;
}

export const SO_LOI_GIU = 5;
export const DAI_LOI_TOI_DA = 160;

/** Rút gọn một thông điệp lỗi: bỏ khoảng trắng thừa, cắt ngắn, gộp các biến thể chỉ khác mã vận đơn. */
export function chuanHoaLoi(msg: string): string {
  const s = msg.split('\n')[0].trim().replace(/\s+/g, ' ');
  // Số dài (mã vận đơn, id) làm mỗi lỗi thành một chuỗi khác nhau → gộp lại.
  const gop = s.split(/\d{6,}/).join('«số»');
  return gop.length > DAI_LOI_TOI_DA ? `${gop.slice(0, DAI_LOI_TOI_DA)}…` : gop;
}

/** Gom danh sách lý do thành bảng đếm, giữ tối đa `SO_LOI_GIU` lý do phổ biến nhất. */
export function gomLoi(msgs: readonly string[], giu = SO_LOI_GIU): Record<string, number> | undefined {
  if (msgs.length === 0) return undefined;
  const dem = new Map<string, number>();
  for (const m of msgs) {
    const k = chuanHoaLoi(m);
    dem.set(k, (dem.get(k) ?? 0) + 1);
  }
  const xep = [...dem.entries()].sort((a, b) => b[1] - a[1]);
  const ra: Record<string, number> = {};
  for (const [k, v] of xep.slice(0, giu)) ra[k] = v;
  const con = xep.slice(giu).reduce((s, [, v]) => s + v, 0);
  if (con > 0) ra['(lý do khác)'] = con;
  return ra;
}

/**
 * Lượt chạy có đáng coi là HỎNG không: có việc để làm mà không tra được kiện nào.
 * Không kiện nào cần tra (failed = tracked = 0) thì là bình thường, không báo động.
 */
export function coiLaHong(t: Pick<TomTatTrack, 'tracked' | 'failed'>): boolean {
  return t.failed > 0 && t.tracked === 0;
}
