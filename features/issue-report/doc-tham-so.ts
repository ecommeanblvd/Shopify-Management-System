/**
 * THUẦN: đọc query string của trang `/f/bao-loi`. Không I/O.
 *
 * `bl` khớp CHẶT `^\d+$` chứ không qua `Number()`: `Number(' 7 ')` ra 7 và `Number('1e9')` ra
 * một tỉ, nên tin `Number()` là mở đường cho `?bl= 7 ` và `?bl=1e9` đi thẳng vào câu truy vấn.
 * Chữ số Ả Rập–Đông (`٧`) cũng bị `Number()` nhận.
 *
 * Và khớp khuôn CHƯA ĐỦ: `issue_reports.so` là `serial`, tức **int4**. Chuỗi toàn chữ số mà
 * vượt 2.147.483.647 vẫn qua regex rồi làm Postgres ném *"value out of range for type integer"*
 * ⇒ **500 cả trang** `/f/bao-loi`, mất luôn ô đếm và bộ lọc. Đo thật trên CSDL 30/10/2026:
 * `so = 1000000000` chạy bình thường, `so = 9999999999` thì nổ. Nên phải có TRẦN.
 */
import { moduleHopLe, trangThaiHopLe } from './phan-loai';

export interface ThamSoBaoLoi {
  /** Số báo lỗi để mở sẵn modal (`BL-<so>`). `null` = không mở gì. */
  so: number | null;
  trangThai: string | null;
  module: string | null;
}

/** Trần của `int4` — kiểu thật của `issue_reports.so`. */
const SO_TOI_DA = 2_147_483_647;

export function docThamSoBaoLoi(sp: URLSearchParams): ThamSoBaoLoi {
  const bl = sp.get('bl') ?? '';
  const n = /^\d+$/.test(bl) ? Number(bl) : NaN;
  const so = Number.isInteger(n) && n > 0 && n <= SO_TOI_DA ? n : null;
  const tt = (sp.get('trangThai') ?? '').trim();
  const md = (sp.get('module') ?? '').trim();
  return {
    so,
    trangThai: trangThaiHopLe(tt) ? tt : null,
    module: moduleHopLe(md) ? md : null,
  };
}
