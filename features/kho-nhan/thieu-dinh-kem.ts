/**
 * THUẦN: phiếu nào còn thiếu đính kèm lúc nhận, và thiếu thứ gì.
 *
 * CEO 25/09: KHÔNG chặn cứng — chỉ báo cho người dùng biết TRƯỚC khi chuyển
 * sang QC. Kho vẫn có quyền đi tiếp (hàng về gấp, brand gửi biên bản sau), chỉ
 * là không được lỡ mà không hay.
 */
import type { LoaiAnhNhan } from './types';

export const TEN_DINH_KEM: Record<LoaiAnhNhan, string> = {
  hang_den: 'ảnh hàng đến',
  bb_ban_giao: 'biên bản bàn giao',
};

const CAN_CO: LoaiAnhNhan[] = ['hang_den', 'bb_ban_giao'];

export interface PhieuThieu { receiptId: string; vendor: string | null; thieu: LoaiAnhNhan[] }

export function timPhieuThieu(
  nhom: readonly { receiptId: string; vendor: string | null }[],
  anh: readonly { receiptId: string; loai: LoaiAnhNhan }[],
): PhieuThieu[] {
  const co = new Map<string, Set<LoaiAnhNhan>>();
  for (const a of anh) {
    const s = co.get(a.receiptId) ?? new Set<LoaiAnhNhan>();
    s.add(a.loai); co.set(a.receiptId, s);
  }
  return nhom
    .map((g) => ({
      receiptId: g.receiptId, vendor: g.vendor,
      thieu: CAN_CO.filter((l) => !co.get(g.receiptId)?.has(l)),
    }))
    .filter((x) => x.thieu.length > 0);
}

/** Câu nhắc gọn cho một lượt: nêu đích danh brand và thứ còn thiếu. */
export function cauNhacThieu(ds: readonly PhieuThieu[]): string {
  if (ds.length === 0) return '';
  const phan = ds.map((p) =>
    `${p.vendor ?? 'không rõ brand'} (thiếu ${p.thieu.map((l) => TEN_DINH_KEM[l]).join(' và ')})`);
  return `Chưa đủ đính kèm: ${phan.join(' · ')}. Bấm lần nữa để vẫn bắt đầu QC.`;
}
