'use client';

import { useState, useTransition } from 'react';
import { traLaiDong12 } from '@/features/kpi-logistics/nop-1-2-actions';

/**
 * Quản lý TRẢ LẠI một dòng lý do giao chậm để người làm sửa.
 *
 * Bắt buộc ghi rõ sai ở đâu: trả lại mà không nói lý do thì người sửa chỉ đoán lại từ đầu, và
 * vòng gửi–trả sẽ lặp mãi. Máy chủ cũng chặn ghi chú rỗng, không chỉ dựa vào form.
 */
export function NutTraLaiDong({ ky, nguon, id, daTraLai, sauKhiLuu }: {
  ky: string;
  nguon: 'shopify' | 'ship_ho';
  id: string;
  daTraLai: string | null;
  sauKhiLuu: () => void;
}) {
  const [mo, setMo] = useState(false);
  const [ghiChu, setGhiChu] = useState('');
  const [loi, setLoi] = useState<string | null>(null);
  const [dangChay, batDau] = useTransition();

  if (daTraLai) {
    return (
      <span className="mt-0.5 block text-[10px] text-amber-600 dark:text-amber-400" title={daTraLai}>
        ↩ Đã trả lại để sửa: {daTraLai}
      </span>
    );
  }

  if (!mo) {
    return (
      <button type="button" onClick={() => setMo(true)}
        className="mt-0.5 cursor-pointer rounded border border-border px-1.5 py-0.5 text-[10px] transition-colors hover:bg-muted">
        Trả lại để sửa
      </button>
    );
  }

  return (
    <div className="mt-1 space-y-1">
      <label className="sr-only" htmlFor={`tra-${id}`}>Sai ở đâu</label>
      <input id={`tra-${id}`} value={ghiChu} onChange={(e) => setGhiChu(e.target.value)}
        placeholder="Sai ở đâu?" disabled={dangChay}
        className="w-full rounded border border-border bg-background px-1.5 py-1 text-[11px]" />
      <div className="flex gap-1">
        <button type="button" disabled={dangChay}
          onClick={() => {
            if (!ghiChu.trim()) { setLoi('Ghi rõ sai ở đâu để người làm biết sửa gì'); return; }
            setLoi(null);
            batDau(async () => {
              try { await traLaiDong12({ ky, nguon, id, ghiChu }); setMo(false); setGhiChu(''); sauKhiLuu(); }
              catch (e) { setLoi(e instanceof Error ? e.message : 'Không lưu được, thử lại'); }
            });
          }}
          className="cursor-pointer rounded bg-amber-600 px-2 py-0.5 text-[10px] font-medium text-white transition-colors hover:bg-amber-700 disabled:opacity-50">
          {dangChay ? 'Đang lưu…' : 'Trả lại'}
        </button>
        <button type="button" onClick={() => { setMo(false); setLoi(null); }} disabled={dangChay}
          className="cursor-pointer rounded px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50">
          Thôi
        </button>
      </div>
      {loi && <p className="text-[10px] text-red-600 dark:text-red-400">{loi}</p>}
    </div>
  );
}
