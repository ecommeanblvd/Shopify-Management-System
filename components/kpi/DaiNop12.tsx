'use client';

import { useState, useTransition } from 'react';
import { nopKy12, duyetKy12, moLaiKy12 } from '@/features/kpi-logistics/nop-1-2-actions';
import { NHAN_TRANG_THAI, moTaTrangThai, nopDuoc, duyetDuocKy, type TrangThaiNop } from '@/features/kpi-logistics/nop-1-2';

const gio = (iso: string | null) =>
  iso == null ? '' : new Date(iso).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/**
 * Dải trạng thái nộp của tiêu chí 1.2: người làm gửi cả kỳ, quản lý duyệt hoặc trả lại từng dòng.
 *
 * Nói rõ AI phải làm gì tiếp theo, không chỉ hiện trạng thái — trạng thái mà không kèm việc thì
 * người đọc vẫn phải đoán.
 */
export function DaiNop12({ ky, trangThai, nopAt, duyetAt, soDongDangTraLai, ganLyDoDuoc, laQuanLy, sauKhiLuu }: {
  ky: string;
  trangThai: TrangThaiNop;
  nopAt: string | null;
  duyetAt: string | null;
  soDongDangTraLai: number;
  ganLyDoDuoc: boolean;
  laQuanLy: boolean;
  sauKhiLuu: () => void;
}) {
  const [loi, setLoi] = useState<string | null>(null);
  const [dangChay, batDau] = useTransition();

  const chay = (fn: () => Promise<unknown>) => {
    setLoi(null);
    batDau(async () => {
      try { await fn(); sauKhiLuu(); }
      catch (e) { setLoi(e instanceof Error ? e.message : 'Không lưu được, thử lại'); }
    });
  };

  const mau = trangThai === 'da_duyet' ? 'border-emerald-600/40 bg-emerald-600/10'
    : trangThai === 'cho_duyet' ? 'border-amber-600/40 bg-amber-600/10'
    : 'border-border bg-card';
  const nut = 'cursor-pointer rounded border border-border px-2.5 py-1 text-xs transition-colors hover:bg-muted disabled:opacity-50';

  return (
    <div className={`mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-4 py-2.5 text-sm ${mau}`}>
      <span className="font-semibold">{NHAN_TRANG_THAI[trangThai]}</span>
      <span className="text-xs text-muted-foreground">
        {moTaTrangThai(trangThai, soDongDangTraLai)}
        {nopAt && trangThai !== 'dang_lam' && <> · gửi lúc {gio(nopAt)}</>}
        {duyetAt && trangThai === 'da_duyet' && <> · duyệt lúc {gio(duyetAt)}</>}
      </span>

      <span className="ml-auto flex flex-wrap items-center gap-1">
        {ganLyDoDuoc && nopDuoc(trangThai) && (
          <button type="button" disabled={dangChay} onClick={() => chay(() => nopKy12(ky))}
            className="cursor-pointer rounded bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50">
            {dangChay ? 'Đang gửi…' : soDongDangTraLai > 0 ? `Gửi lại (đã sửa ${soDongDangTraLai} dòng)` : 'Gửi quản lý duyệt'}
          </button>
        )}
        {laQuanLy && trangThai === 'cho_duyet' && (
          <button type="button" disabled={dangChay || !duyetDuocKy(trangThai, soDongDangTraLai)}
            title={soDongDangTraLai > 0 ? 'Còn dòng đang trả lại chưa sửa' : undefined}
            onClick={() => chay(() => duyetKy12(ky))}
            className="cursor-pointer rounded bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50">
            Duyệt cả kỳ
          </button>
        )}
        {laQuanLy && trangThai === 'da_duyet' && (
          <button type="button" disabled={dangChay} onClick={() => chay(() => moLaiKy12(ky))} className={nut}>
            Mở lại kỳ
          </button>
        )}
      </span>
      {loi && <p className="w-full text-xs text-red-600 dark:text-red-400">{loi}</p>}
    </div>
  );
}
