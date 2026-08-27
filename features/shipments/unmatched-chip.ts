/**
 * Gom dữ liệu cho dải thông báo gọn ở đầu màn Đối soát ship.
 *
 * Trước đây mỗi nhóm in thẳng toàn bộ mã ra banner: một kỳ có 60 mã ship hộ và
 * 15 dòng cước hàng hoàn, chiếm gần nửa màn hình trước khi thấy được bảng đối
 * soát. Gom lại theo đơn rồi đóng vào chip để chỉ còn một dòng.
 */
import type { UnmatchedBilledRow } from './unmatched-billed';

export interface TomTatChip { soDong: number; tongVnd: number }

export function tomTatChip(rows: readonly UnmatchedBilledRow[]): TomTatChip {
  return {
    soDong: rows.length,
    tongVnd: rows.reduce((s, r) => s + (r.amountVnd ?? 0), 0),
  };
}

export interface MucGomTheoDon { ma: string; soTracking: number; tongVnd: number }

/**
 * Gom các dòng theo mã đơn. Một đơn có thể có nhiều kiện nên nhiều tracking —
 * liệt kê từng tracking là lặp lại cùng một đơn nhiều lần.
 */
export function gopMaTheoDon(
  rows: readonly UnmatchedBilledRow[],
  layMa: (r: UnmatchedBilledRow) => string | null,
): MucGomTheoDon[] {
  const map = new Map<string, MucGomTheoDon>();
  for (const r of rows) {
    const ma = layMa(r)?.trim();
    if (!ma) continue;
    const cur = map.get(ma) ?? { ma, soTracking: 0, tongVnd: 0 };
    cur.soTracking += 1;
    cur.tongVnd += r.amountVnd ?? 0;
    map.set(ma, cur);
  }
  // Sắp theo mã để thứ tự không đổi giữa các lần tải trang.
  return [...map.values()].sort((a, b) => a.ma.localeCompare(b.ma));
}
