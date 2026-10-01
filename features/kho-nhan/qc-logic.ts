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

/**
 * THUẦN: chiếc ở trạng thái này có THÊM được dòng lỗi (bổ sung bằng chứng) không.
 *
 * Chỉ `fail`. Thêm lỗi cho chiếc `pass` là ghi bằng chứng lỗi vào hàng ĐÃ VÀO TỒN — hai sự thật
 * ngược nhau trên cùng một chiếc, và không có đường nào rút hàng ra. Chiếc `pending` phải đi
 * `qcKhongDat` để trạng thái và Lark được cập nhật; thêm lỗi suông là chiếc vẫn nằm "chờ QC"
 * trong khi hồ sơ lỗi đã có — đúng kiểu dữ liệu nói một đằng, trạng thái nói một nẻo.
 *
 * Trả LÝ DO khác nhau cho hai ca: "chưa kiểm" cần người bấm Kiểm, "đã đạt" là bế tắc thật.
 */
export function themDuocLoi(qc: KetQuaQc): { ok: true } | { ok: false; loi: string } {
  if (qc === 'fail') return { ok: true };
  return { ok: false, loi: qc === 'pending'
    ? 'Chiếc này chưa kiểm — bấm Kiểm để ghi lỗi.'
    : 'Chiếc này đã kiểm ĐẠT — không thêm được lỗi.' };
}

export interface DongLoiVao { lyDo: LyDoLoi; anhKey: string | null; ghiChu: string }

export function kiemLoQc(dong: readonly DongLoiVao[]):
  | { ok: true } | { ok: false; loi: string } {
  if (dong.length === 0) return { ok: false, loi: 'Phải ghi ít nhất một chỗ lỗi.' };
  for (let i = 0; i < dong.length; i++) {
    const r = kiemDongLoi(dong[i]!);
    if (!r.ok) return { ok: false, loi: `Chỗ lỗi ${i + 1}: ${r.loi}` };
  }
  return { ok: true };
}
