import { kiemDongLoi, type LyDoLoi } from './loi-qc';

export type KetQuaQc = 'pending' | 'pass' | 'fail';

/**
 * THUẦN: QC chỉ chạy MỘT LẦN cho một chiếc.
 *
 * Đã `pass` là hàng đã vào tồn qua `applyMovement`; cho QC lại là nhập đôi hoặc
 * trừ tồn của chiếc đã bán. Muốn sửa thì phải đi đường điều chỉnh tồn riêng.
 */
export function chuyenDuocQc(tu: KetQuaQc): boolean {
  return tu === 'pending';
}

export interface DongLoiVao { lyDo: LyDoLoi; anhKey: string | null; ghiChu: string }

export function kiemLoQc(dong: readonly DongLoiVao[], coStorage: boolean):
  | { ok: true } | { ok: false; loi: string } {
  if (dong.length === 0) return { ok: false, loi: 'Phải ghi ít nhất một chỗ lỗi.' };
  for (let i = 0; i < dong.length; i++) {
    const r = kiemDongLoi({ ...dong[i]!, coStorage });
    if (!r.ok) return { ok: false, loi: `Chỗ lỗi ${i + 1}: ${r.loi}` };
  }
  return { ok: true };
}
