'use client';

import { useState } from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';

/** Tuần bắt đầu THỨ HAI — lịch Việt Nam, không phải Chủ nhật như mặc định Mỹ. */
const THU_NGAN = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

function ISO(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Lịch chọn ngày cho Sổ nhập (bản thiết kế CEO 26/09).
 *
 * Tuần bắt đầu THỨ HAI, không phải Chủ nhật — lịch Việt Nam. Ngày TƯƠNG LAI bị
 * khoá: sổ chỉ ghi việc đã xảy ra, cho bấm sang ngày mai là mở ra một màn trống
 * rồi người dùng tưởng mất dữ liệu.
 *
 * Ngày CÓ hàng được chấm một dấu nhỏ — nhìn là biết nên bấm vào đâu, đỡ phải
 * dò từng ngày một.
 */
export function LichNgay({
  ngay, homNay, cacNgay, onChon, onDong,
}: {
  ngay: string; homNay: string; cacNgay: string[];
  onChon: (s: string) => void; onDong: () => void;
}) {
  const chon = new Date(`${ngay}T00:00:00`);
  const [thang, setThang] = useState(() => new Date(chon.getFullYear(), chon.getMonth(), 1));
  const coHang = new Set(cacNgay);

  const y = thang.getFullYear();
  const m = thang.getMonth();
  // (getDay() + 6) % 7 đổi Chủ nhật=0 thành Chủ nhật=6, để tuần bắt đầu Thứ Hai.
  const dem = (new Date(y, m, 1).getDay() + 6) % 7;
  const soNgay = new Date(y, m + 1, 0).getDate();
  const conSau = ISO(y, m + 1, 1) <= homNay;

  return (
    <>
      {/* Lớp phủ bắt cú bấm ra ngoài — không có nó thì lịch không đóng được
          bằng chuột, chỉ còn cách bấm lại đúng nút mở. */}
      <button
        type="button" aria-label="Đóng lịch" onClick={onDong}
        className="fixed inset-0 z-20 cursor-default"
      />
      <div className="absolute left-[-4px] top-[calc(100%+10px)] z-[21] flex w-[260px] flex-col gap-2 rounded-xl border border-border bg-popover p-3 shadow-lg">
        <div className="flex items-center justify-between">
          <button
            type="button" aria-label="Tháng trước"
            onClick={() => setThang(new Date(y, m - 1, 1))}
            className="grid size-7 cursor-pointer place-items-center rounded-[7px] hover:bg-muted"
          ><ChevronLeftIcon className="size-4" /></button>
          <span className="text-[13px] font-semibold">Tháng {m + 1}, {y}</span>
          <button
            type="button" aria-label="Tháng sau" disabled={!conSau}
            onClick={() => conSau && setThang(new Date(y, m + 1, 1))}
            className="grid size-7 cursor-pointer place-items-center rounded-[7px] hover:bg-muted disabled:cursor-default disabled:opacity-40"
          ><ChevronRightIcon className="size-4" /></button>
        </div>

        <div className="grid grid-cols-7 gap-0.5 text-center text-[11px] text-muted-foreground">
          {THU_NGAN.map((t) => <span key={t}>{t}</span>)}
        </div>

        <div className="grid grid-cols-7 gap-0.5">
          {Array.from({ length: dem }, (_, i) => <span key={`e${i}`} />)}
          {Array.from({ length: soNgay }, (_, i) => {
            const s = ISO(y, m, i + 1);
            const tuongLai = s > homNay;
            const dangChon = s === ngay;
            return (
              <button
                key={s} type="button" disabled={tuongLai}
                onClick={() => onChon(s)}
                className={`relative grid h-8 cursor-pointer place-items-center rounded-[7px] border text-xs ${
                  dangChon ? 'border-transparent bg-foreground font-semibold text-background'
                  : s === homNay ? 'border-muted-foreground font-semibold'
                  : 'border-transparent'
                } ${tuongLai ? 'cursor-default text-muted-foreground/40' : 'hover:bg-muted'}`}
              >
                {i + 1}
                {coHang.has(s) && !dangChon && (
                  <span className="absolute bottom-1 size-1 rounded-full bg-emerald-500" />
                )}
              </button>
            );
          })}
        </div>

        <button
          type="button" onClick={() => onChon(homNay)}
          className="h-[30px] cursor-pointer rounded-lg border border-input text-xs hover:bg-muted"
        >Về hôm nay</button>
      </div>
    </>
  );
}
