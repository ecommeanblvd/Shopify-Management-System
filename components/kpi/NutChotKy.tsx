'use client';

import { useState, useTransition } from 'react';
import { chotKyKpi, moLaiKyKpi } from '@/features/kpi-logistics/chot-actions';

const ngayGio = (iso: string) =>
  new Date(iso).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * Chốt / mở lại một kỳ KPI (CEO 29/09/2026).
 *
 * Kỳ ĐÃ CHỐT hiện thành một dải rõ ràng, vì người đọc cần biết ngay con số đang xem là ảnh chụp
 * hay số sống — hai thứ đó trả lời khác nhau cho cùng một câu hỏi.
 *
 * MỞ LẠI hỏi xác nhận: nó gỡ con số HR đã trả lương theo, và lần chốt sau sẽ ra số khác vì dữ
 * liệu đã chạy tiếp.
 */
export function NutChotKy({ ky, daChot, suaDuoc }: {
  ky: string;
  daChot: { chotAt: string; ghiChu: string | null } | null;
  suaDuoc: boolean;
}) {
  const [moForm, setMoForm] = useState(false);
  const [ghiChu, setGhiChu] = useState('');
  const [xacNhanMo, setXacNhanMo] = useState(false);
  const [loi, setLoi] = useState<string | null>(null);
  const [dangChay, batDau] = useTransition();

  const chay = (fn: () => Promise<unknown>) => {
    setLoi(null);
    batDau(async () => {
      try { await fn(); setMoForm(false); setXacNhanMo(false); setGhiChu(''); }
      catch (e) { setLoi(e instanceof Error ? e.message : 'Không lưu được, thử lại'); }
    });
  };

  if (daChot) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-emerald-600/30 bg-emerald-600/10 px-4 py-2.5 text-sm">
        <span className="font-semibold text-emerald-700 dark:text-emerald-400">Kỳ {ky} đã chốt</span>
        <span className="text-xs text-muted-foreground">
          Chốt lúc {ngayGio(daChot.chotAt)} — bảng dưới đây là ảnh chụp số liệu tại thời điểm đó, không tính lại.
          {daChot.ghiChu && <span className="block">{daChot.ghiChu}</span>}
        </span>
        {suaDuoc && (xacNhanMo ? (
          <span className="flex items-center gap-1">
            <button type="button" onClick={() => chay(() => moLaiKyKpi(ky))} disabled={dangChay}
              className="cursor-pointer rounded bg-red-600 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50">
              {dangChay ? 'Đang mở…' : 'Xác nhận mở lại'}
            </button>
            <button type="button" onClick={() => setXacNhanMo(false)} disabled={dangChay}
              className="cursor-pointer rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50">Thôi</button>
          </span>
        ) : (
          <button type="button" onClick={() => setXacNhanMo(true)}
            className="ml-auto cursor-pointer rounded border border-border px-2.5 py-1 text-xs transition-colors hover:bg-muted">
            Mở lại kỳ
          </button>
        ))}
        {loi && <p className="w-full text-xs text-red-600 dark:text-red-400">{loi}</p>}
      </div>
    );
  }

  if (!suaDuoc) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm">
      <span className="text-xs text-muted-foreground">
        Kỳ {ky} <b>chưa chốt</b> — số liệu vẫn đang tính lại từ dữ liệu sống, nên còn thay đổi khi hoá đơn carrier về thêm.
      </span>
      {moForm ? (
        <span className="ml-auto flex flex-wrap items-center gap-1">
          <label className="sr-only" htmlFor={`chot-${ky}`}>Ghi chú khi chốt</label>
          <input id={`chot-${ky}`} value={ghiChu} onChange={(e) => setGhiChu(e.target.value)}
            placeholder="Ghi chú (không bắt buộc)" disabled={dangChay}
            className="rounded border border-border bg-background px-2 py-1 text-xs" />
          <button type="button" onClick={() => chay(() => chotKyKpi({ ky, ghiChu }))} disabled={dangChay}
            className="cursor-pointer rounded bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50">
            {dangChay ? 'Đang chốt…' : 'Chốt kỳ này'}
          </button>
          <button type="button" onClick={() => { setMoForm(false); setLoi(null); }} disabled={dangChay}
            className="cursor-pointer rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50">Thôi</button>
        </span>
      ) : (
        <button type="button" onClick={() => setMoForm(true)}
          className="ml-auto cursor-pointer rounded border border-border px-2.5 py-1 text-xs transition-colors hover:bg-muted">
          Chốt kỳ
        </button>
      )}
      {loi && <p className="w-full text-xs text-red-600 dark:text-red-400">{loi}</p>}
    </div>
  );
}
