/**
 * THUẦN: gom các dòng `wh_loi_qc` của một chiếc lại thành CHỖ LỖI để hiện ra. Không I/O.
 *
 * Vì sao cần: từ 09/10/2026 một chỗ lỗi gắn được nhiều ảnh, mà bảng vẫn giữ một dòng một ảnh
 * (xem `moRongDongLoi`). Liệt kê thẳng từng dòng thì ba tấm ảnh của cùng vết bẩn in ra ba dòng
 * "Bẩn · gấu váy" giống hệt nhau — người đọc tưởng hệ thống ghi trùng.
 *
 * Khoá gom là LÝ DO + GHI CHÚ, không phải lý do suông: "Bẩn (gấu váy)" và "Bẩn (cổ áo)" là hai
 * chỗ lỗi thật trên cùng chiếc áo, gộp lại là mất chi tiết người kiểm đã gõ.
 */
import type { AnhLoiQc } from './anh-loi-qc';
import type { LyDoLoi } from './loi-qc';

export interface NhomAnhLoi {
  /** Khoá ổn định để làm `key` khi vẽ danh sách. */
  khoa: string;
  lyDo: LyDoLoi;
  nhanLyDo: string;
  ghiChu: string;
  anh: AnhLoiQc[];
}

export function gomAnhLoi(ds: readonly AnhLoiQc[]): NhomAnhLoi[] {
  const theo = new Map<string, NhomAnhLoi>();
  for (const a of ds) {
    const ghiChu = (a.ghiChu ?? '').trim();
    const khoa = `${a.lyDo}\n${ghiChu}`;
    const co = theo.get(khoa);
    if (co) { co.anh.push(a); continue; }
    // Thứ tự xuất hiện lần đầu — không sắp xếp lại: đó là thứ tự người kiểm đã nhập.
    theo.set(khoa, { khoa, lyDo: a.lyDo, nhanLyDo: a.nhanLyDo, ghiChu, anh: [a] });
  }
  return [...theo.values()];
}
