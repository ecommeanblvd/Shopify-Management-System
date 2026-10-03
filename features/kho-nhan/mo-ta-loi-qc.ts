/**
 * THUẦN: gộp các dòng lỗi QC thành một câu cho cột `Lý do QC failed` trên Lark. Không I/O.
 *
 * Cột bên Lark là một ô TEXT, trong khi bên mình lỗi là nhiều DÒNG (`wh_loi_qc`) — mỗi dòng một
 * lý do, có thể kèm ghi chú và ảnh. Phải gộp, và gộp sao cho đội kho đọc hiểu được ngay.
 */
import { NHAN_LY_DO, type LyDoLoi } from './loi-qc';

export interface DongLoiMoTa {
  lyDo: LyDoLoi;
  ghiChu: string | null;
}

/**
 * Câu mô tả, hoặc chuỗi rỗng khi không có dòng lỗi nào.
 *
 * Trả chuỗi RỖNG chứ không `null`: người gọi ghi thẳng lên Lark, và rỗng là "xoá lý do cũ" —
 * đúng thứ cần khi một chiếc được kiểm lại thành đạt.
 *
 * Gộp trùng lý do: kho hay ghi hai dòng cùng lý do với hai tấm ảnh khác nhau, in ra "Bẩn · Bẩn"
 * thì đọc như lỗi đánh máy. Nhưng GHI CHÚ thì giữ cả, vì mỗi ghi chú là một chi tiết riêng.
 */
export function moTaLoiQc(dong: readonly DongLoiMoTa[]): string {
  const theoLyDo = new Map<LyDoLoi, string[]>();
  for (const d of dong) {
    const ds = theoLyDo.get(d.lyDo) ?? [];
    const g = (d.ghiChu ?? '').trim();
    if (g) ds.push(g);
    theoLyDo.set(d.lyDo, ds);
  }
  return [...theoLyDo].map(([lyDo, ghiChu]) => {
    const nhan = NHAN_LY_DO[lyDo];
    return ghiChu.length > 0 ? `${nhan} (${[...new Set(ghiChu)].join('; ')})` : nhan;
  }).join(' · ');
}
