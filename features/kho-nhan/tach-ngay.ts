/**
 * THUẦN: tách danh sách đang kiểm thành "nhận hôm nay" và "tồn từ hôm trước".
 *
 * CEO 25/09: mỗi phiên làm, workspace nhận & kiểm phải sạch. Nhưng chiếc đã
 * nhận mà chưa QC là VIỆC DANG DỞ — đẩy hẳn nó ra khỏi màn là giấu việc chưa
 * xong vào 9.000 dòng lịch sử rồi không ai nhớ ra nữa. Nên nó ở lại, chỉ tách
 * thành một nhóm riêng có nhãn đếm số để không lẫn vào việc của hôm nay.
 */
import { ngayKinhDoanh } from '@/lib/timezone';

export interface CoNgay { taoLuc: Date }

export function tachTheoNgay<T extends CoNgay>(
  ds: readonly T[], homNay: string,
): { homNay: T[]; truoc: T[] } {
  const a: T[] = []; const b: T[] = [];
  for (const c of ds) {
    // Ngày NGHIỆP VỤ (giờ Việt Nam), không phải ngày UTC: hàng nhận buổi tối
    // rơi sang hôm trước nếu tính theo UTC — hơn 1/3 số mốc bị lệch (lib/timezone).
    (ngayKinhDoanh(c.taoLuc) === homNay ? a : b).push(c);
  }
  return { homNay: a, truoc: b };
}

export interface CoPhieu { receiptId: string; vendor: string | null }

/**
 * Gom chiếc theo PHIẾU NHẬN, giữ nguyên thứ tự phiếu xuất hiện lần đầu.
 *
 * Ảnh hàng đến và biên bản bàn giao gắn ở mức phiếu, nên màn nhận phải nhóm
 * theo phiếu mới có chỗ treo hai thứ đó. Một ngày kho nhận hàng của nhiều
 * brand thì mỗi brand là một phiếu riêng (maPhieuNhan: ngày + vendor + kho).
 */
export function gomTheoPhieu<T extends CoPhieu>(
  ds: readonly T[],
): { receiptId: string; vendor: string | null; chiec: T[] }[] {
  const theo = new Map<string, { receiptId: string; vendor: string | null; chiec: T[] }>();
  for (const c of ds) {
    const g = theo.get(c.receiptId);
    if (g) g.chiec.push(c);
    else theo.set(c.receiptId, { receiptId: c.receiptId, vendor: c.vendor, chiec: [c] });
  }
  return [...theo.values()];
}
