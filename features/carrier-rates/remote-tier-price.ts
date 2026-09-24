/**
 * Tìm những TIER có mã bưu chính nhưng KHÔNG có dòng phụ phí nào trả giá.
 *
 * Vì sao cần: `sumRemoteFixed` trong `engine/quote.ts` lọc phụ phí theo tier rồi
 * `.reduce(..., 0)` — không dòng nào khớp thì trả 0 và bản báo giá trông vẫn
 * đầy đủ. Trước đây đó là chuyện gần như không xảy ra (FedEx có đủ Tier A/B/C,
 * DHL dùng một dòng chung). Từ lúc nạp danh sách EAS của UPS thì nó thành
 * chuyện THẬT: ba hạng mục — "Phụ phí Khu vực Phát hàng", "… - Mở rộng" và
 * "Phụ phí Vùng sâu vùng xa - Mở rộng" — có mã bưu chính mà chưa có giá (CEO
 * sẽ gửi bảng giá UPS sau). Một đơn rơi đúng vùng đó sẽ được báo giá thiếu,
 * lặng lẽ.
 *
 * Nên nó phải KÊU. Hàm này thuần, không DB, để trang surcharges và test dùng
 * chung — cùng kiểu với `manual-fuel-staleness.ts`.
 */

/** Một tier đang có mã bưu chính, kèm số dòng. */
export interface TierCoMa {
  /** NULL = dòng không phân bậc (DHL lưu như vậy). */
  tier: string | null;
  soDong: number;
}

/** Dòng phụ phí tối giản — đủ để biết tier nào đã có giá. */
export interface DongPhuPhi {
  kind: string;
  tier: string | null;
  active: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
}

export interface TierThieuGia {
  /** NULL = nhóm dòng không phân bậc. */
  tier: string | null;
  soDong: number;
}

/** Cùng luật hiệu lực với `isApplicable` của engine: bật, đã bắt đầu, chưa kết thúc. */
function dangHieuLuc(s: DongPhuPhi, luc: Date): boolean {
  if (!s.active) return false;
  if (s.startsAt && s.startsAt > luc) return false;
  if (s.endsAt && s.endsAt <= luc) return false;
  return true;
}

/**
 * Trả về các tier có mã bưu chính mà không dòng `remote_fixed` nào đang hiệu
 * lực sẽ khớp — tức báo giá cho vùng đó đang cộng thêm 0 đồng.
 *
 * Phản chiếu đúng bộ lọc của `sumRemoteFixed`: một dòng phụ phí khớp khi nó
 * KHÔNG ghi tier (dòng chung, áp cho mọi lần khớp remote) hoặc ghi đúng tier
 * đó. Vì vậy chỉ cần MỘT dòng chung là cả tài khoản có giá — đúng như DHL.
 *
 * Kết quả xếp theo số dòng giảm dần: tier phủ nhiều mã nhất là chỗ mất tiền
 * nhiều nhất.
 */
export function timTierThieuGia(
  tiers: readonly TierCoMa[],
  phuPhi: readonly DongPhuPhi[],
  luc: Date = new Date(),
): TierThieuGia[] {
  const remote = phuPhi.filter((s) => s.kind === 'remote_fixed' && dangHieuLuc(s, luc));
  const coDongChung = remote.some((s) => !s.tier);
  if (coDongChung) return [];

  const daCoGia = new Set(remote.map((s) => s.tier).filter((t): t is string => !!t));
  return tiers
    .filter((t) => t.soDong > 0 && !(t.tier !== null && daCoGia.has(t.tier)))
    .sort((a, b) => b.soDong - a.soDong);
}
