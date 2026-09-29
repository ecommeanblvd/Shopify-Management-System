'use client';

import { useState, useTransition } from 'react';
import { duyetLyDoCham } from '@/features/shipments/ly-do-actions';

/**
 * Duyệt tay lý do giao chậm cho kiện mà hệ thống KHÔNG kiểm được (CEO 29/09/2026).
 *
 * Chỉ hiện ở đúng chỗ máy mù — nơi gọi quyết định bằng `duyetTayDuoc`. Ở ca hãng đã tra và không
 * thấy dấu hiệu, nút này KHÔNG được xuất hiện; máy chủ cũng chặn lần nữa, vì ẩn nút mà hành động
 * vẫn gọi được thì chưa phải là chặn.
 *
 * Bắt buộc ghi chú khi DUYỆT: duyệt là thay bằng chứng của hãng bằng lời của một người, nên phải
 * có câu trả lời cho "dựa vào đâu" nằm lại trong hệ thống. Từ chối thì không bắt buộc — nó giữ
 * nguyên hiện trạng, không cần bào chữa.
 */
export function NutDuyetLyDo({ shipmentId, nguon, daDuyet, sauKhiLuu }: {
  shipmentId: string;
  nguon: 'shopify' | 'ship_ho';
  daDuyet: string | null;
  sauKhiLuu: () => void;
}) {
  const [moForm, setMoForm] = useState(false);
  const [ghiChu, setGhiChu] = useState('');
  const [loi, setLoi] = useState<string | null>(null);
  const [dangChay, batDau] = useTransition();

  function gui(quyetDinh: 'duyet' | 'tu_choi') {
    if (quyetDinh === 'duyet' && !ghiChu.trim()) {
      setLoi('Ghi rõ căn cứ duyệt (email khách, ảnh chụp, trao đổi với hãng…)');
      return;
    }
    setLoi(null);
    batDau(async () => {
      try {
        await duyetLyDoCham({ shipmentId, nguon, quyetDinh, ghiChu });
        setMoForm(false);
        setGhiChu('');
        sauKhiLuu();
      } catch (e) {
        setLoi(e instanceof Error ? e.message : 'Không lưu được, thử lại');
      }
    });
  }

  if (daDuyet === 'duyet') {
    return <span className="mt-0.5 block text-[10px] text-emerald-600 dark:text-emerald-400">✓ Quản lý đã duyệt — rời mẫu số</span>;
  }
  if (daDuyet === 'tu_choi') {
    return <span className="mt-0.5 block text-[10px] text-red-600 dark:text-red-400">✗ Quản lý từ chối — vẫn tính trễ</span>;
  }

  if (!moForm) {
    return (
      <button type="button" onClick={() => setMoForm(true)}
        className="mt-0.5 cursor-pointer rounded border border-border px-1.5 py-0.5 text-[10px] transition-colors hover:bg-muted">
        Duyệt tay
      </button>
    );
  }

  return (
    <div className="mt-1 space-y-1">
      <label className="sr-only" htmlFor={`duyet-${shipmentId}`}>Căn cứ duyệt</label>
      <input id={`duyet-${shipmentId}`} value={ghiChu} onChange={(e) => setGhiChu(e.target.value)}
        placeholder="Căn cứ duyệt…" disabled={dangChay}
        className="w-full rounded border border-border bg-background px-1.5 py-1 text-[11px]" />
      <div className="flex gap-1">
        <button type="button" onClick={() => gui('duyet')} disabled={dangChay}
          className="cursor-pointer rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50">
          {dangChay ? 'Đang lưu…' : 'Duyệt'}
        </button>
        <button type="button" onClick={() => gui('tu_choi')} disabled={dangChay}
          className="cursor-pointer rounded border border-border px-2 py-0.5 text-[10px] transition-colors hover:bg-muted disabled:opacity-50">
          Từ chối
        </button>
        <button type="button" onClick={() => { setMoForm(false); setLoi(null); }} disabled={dangChay}
          className="cursor-pointer rounded px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50">
          Thôi
        </button>
      </div>
      {loi && <p className="text-[10px] text-red-600 dark:text-red-400">{loi}</p>}
    </div>
  );
}
