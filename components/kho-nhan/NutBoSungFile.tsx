'use client';

import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { PaperclipIcon } from 'lucide-react';
import { boSungFileLark } from '@/features/kho-nhan/bo-sung-anh-actions';
import { KIEU_CHO_PHEP, TEN_LOAI, type LoaiFile } from '@/features/kho-nhan/bo-sung-anh';

/**
 * Nút bổ sung ảnh / BBGN ngay trên dòng Sổ nhập (CEO 29/09/2026).
 *
 * Chỉ hiện ở dòng ĐANG THIẾU loại file đó — dòng đã có thì không cho tải nữa
 * (CEO chốt), nên không có đường nào để máy đè file đội kho đã đưa lên.
 *
 * Tải xong áp cho CẢ ĐƠN trong NGÀY đó: một đơn nhiều SKU nhưng chụp chung một
 * bộ ảnh. Số dòng thật sự được gắn hiện trong thông báo để người tải biết nó
 * vừa chạm tới bao nhiêu dòng, không phải đoán.
 */
export function NutBoSungFile({ recordId, loai, maDon }: {
  recordId: string; loai: LoaiFile; maDon: string | null;
}) {
  const oFile = useRef<HTMLInputElement>(null);
  const [dangDay, start] = useTransition();
  const [xong, setXong] = useState(false);

  // Đã đẩy xong thì đổi hẳn sang dấu tích: bản sao trong SMS cập nhật ngay nhưng
  // ảnh nhỏ phải đợi lượt đồng bộ sau mới có, nên đừng để ô trông như chưa làm gì.
  if (xong) return <span className="block text-center text-xs text-emerald-600 dark:text-emerald-400">✓</span>;

  const chon = (fs: FileList | null) => {
    if (!fs || fs.length === 0) return;
    const form = new FormData();
    for (const f of Array.from(fs)) form.append('file', f);
    start(async () => {
      const r = await boSungFileLark(recordId, loai, form);
      if (!r.ok) { toast.error(r.loi ?? 'Đẩy tệp lên Lark thất bại.', { duration: 8000 }); return; }
      toast.success(
        `Đã gắn ${r.soFile} tệp ${TEN_LOAI[loai].toLowerCase()} vào ${r.soDong} dòng${maDon ? ` của ${maDon}` : ''}.`,
        { duration: 5000 },
      );
      setXong(true);
    });
    if (oFile.current) oFile.current.value = '';
  };

  return (
    <span className="block text-center">
      <input
        ref={oFile} type="file" multiple hidden
        accept={KIEU_CHO_PHEP.join(',')}
        onChange={(e) => chon(e.target.files)}
      />
      <button
        type="button" disabled={dangDay}
        onClick={() => oFile.current?.click()}
        title={`Thiếu ${TEN_LOAI[loai].toLowerCase()} — bấm để tải lên, áp cho cả đơn trong ngày`}
        aria-label={`Bổ sung ${TEN_LOAI[loai].toLowerCase()}`}
        className="mx-auto grid size-7 cursor-pointer place-items-center rounded border border-dashed border-border text-muted-foreground transition hover:border-foreground/40 hover:text-foreground disabled:cursor-default disabled:opacity-50"
      >
        {dangDay ? <span className="text-[9px]">…</span> : <PaperclipIcon className="size-3.5" />}
      </button>
    </span>
  );
}
