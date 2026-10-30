/**
 * THUẦN: đọc query string của trang `/f/bao-loi`. Không I/O.
 *
 * `bl` khớp CHẶT `^\d+$` chứ không qua `Number()`: `Number(' 7 ')` ra 7 và `Number('1e9')` ra
 * một tỉ, nên tin `Number()` là mở đường cho `?bl= 7 ` và `?bl=1e9` đi thẳng vào câu truy vấn.
 * Chữ số Ả Rập–Đông (`٧`) cũng bị `Number()` nhận.
 */
import { moduleHopLe, trangThaiHopLe } from './phan-loai';

export interface ThamSoBaoLoi {
  /** Số báo lỗi để mở sẵn modal (`BL-<so>`). `null` = không mở gì. */
  so: number | null;
  trangThai: string | null;
  module: string | null;
}

export function docThamSoBaoLoi(sp: URLSearchParams): ThamSoBaoLoi {
  const bl = sp.get('bl') ?? '';
  const so = /^\d+$/.test(bl) && Number(bl) > 0 ? Number(bl) : null;
  const tt = (sp.get('trangThai') ?? '').trim();
  const md = (sp.get('module') ?? '').trim();
  return {
    so,
    trangThai: trangThaiHopLe(tt) ? tt : null,
    module: moduleHopLe(md) ? md : null,
  };
}
