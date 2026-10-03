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
 * Ảnh hàng đến / biên bản: tải xong áp cho CẢ ĐƠN trong NGÀY đó — một đơn nhiều SKU nhưng chụp
 * chung một bộ ảnh. Ảnh LỖI QC thì chỉ đúng dòng đó, vì lỗi là chuyện của từng chiếc. Số dòng
 * thật sự được gắn hiện trong thông báo để người tải biết nó vừa chạm tới đâu, không phải đoán.
 */
/**
 * `bienThe`:
 *  - `'o'` — ô kẹp giấy 28px nằm trong ô bảng Sổ nhập;
 *  - `'nut'` — nút có chữ, dùng trong modal chi tiết nơi còn chỗ (CEO 03/10/2026).
 *
 * MỘT component cho cả hai: cùng một việc, cùng một server action, cùng ba cách đưa ảnh vào
 * (bấm · dán · kéo thả). Dựng component thứ hai chỉ để đổi hình dáng nút là đúng loại lỗi "hai
 * nguồn cho một việc" đã sửa nhiều lần trong ngày.
 */
export function NutBoSungFile({ recordId, loai, maDon, bienThe = 'o' }: {
  recordId: string; loai: LoaiFile; maDon: string | null; bienThe?: 'o' | 'nut';
}) {
  const oFile = useRef<HTMLInputElement>(null);
  const [dangDay, start] = useTransition();
  const [xong, setXong] = useState(false);

  /* Ô TRÊN BẢNG đẩy xong thì đổi hẳn sang dấu tích: ô đó chỉ hiện khi dòng chưa có file, và
   * ảnh nhỏ phải đợi lượt đồng bộ sau mới có — đừng để ô trông như chưa làm gì.
   *
   * NÚT TRONG MODAL thì KHÔNG khoá: lượt ghi đã cập nhật bản sao nên thẻ ảnh hiện ngay, và ảnh
   * lỗi là thứ còn thêm tấm nữa. Khoá lại là bắt người ta đóng mở modal cho mỗi tấm. */
  if (xong && bienThe === 'o') {
    return <span className="block text-center text-xs text-emerald-600 dark:text-emerald-400">✓</span>;
  }

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

  const chung = {
    disabled: dangDay,
    onClick: () => oFile.current?.click(),
    /* Dán và kéo thả, không chỉ bấm chọn (CEO 01/10/2026): ảnh hàng về thường nằm trong Zalo.
     * Nút này focus được nên Ctrl/Cmd+V vào nó là dán được; `chon` nhận `FileList` nên dùng
     * thẳng được cả ba nguồn, không cần đường tải thứ hai. */
    onPaste: (e: React.ClipboardEvent) => {
      if (dangDay) return;
      const f = e.clipboardData?.files;
      if (f?.length) { e.preventDefault(); chon(f); }
    },
    onDragOver: (e: React.DragEvent) => { if (!dangDay) e.preventDefault(); },
    onDrop: (e: React.DragEvent) => {
      if (dangDay) return;
      const f = e.dataTransfer?.files;
      if (f?.length) { e.preventDefault(); chon(f); }
    },
    title: `Chưa có ${TEN_LOAI[loai].toLowerCase()} — bấm để tải lên, dán (Ctrl/Cmd+V) hoặc kéo thả cũng được; ${
      loai === 'loi_qc' ? 'chỉ gắn vào đúng dòng này' : 'áp cho cả đơn trong ngày'}`,
  };

  const oNhap = (
    <input
      ref={oFile} type="file" multiple hidden
      accept={KIEU_CHO_PHEP.join(',')}
      onChange={(e) => chon(e.target.files)}
    />
  );

  if (bienThe === 'nut') {
    return (
      <>
        {oNhap}
        <button
          type="button" {...chung}
          aria-label={`Thêm ${TEN_LOAI[loai].toLowerCase()}`}
          className="mt-2 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-border px-2 py-2 text-xs text-muted-foreground transition hover:border-foreground/40 hover:text-foreground disabled:cursor-default disabled:opacity-50"
        >
          <PaperclipIcon className="size-3.5" />
          {dangDay ? 'Đang tải…' : xong ? 'Thêm tấm nữa · dán được' : 'Thêm ảnh · dán được'}
        </button>
      </>
    );
  }

  return (
    <span className="block text-center">
      <input
        ref={oFile} type="file" multiple hidden
        accept={KIEU_CHO_PHEP.join(',')}
        onChange={(e) => chon(e.target.files)}
      />
      <button
        type="button" {...chung}
        aria-label={`Bổ sung ${TEN_LOAI[loai].toLowerCase()}`}
        className="mx-auto grid size-7 cursor-pointer place-items-center rounded border border-dashed border-border text-muted-foreground transition hover:border-foreground/40 hover:text-foreground disabled:cursor-default disabled:opacity-50"
      >
        {dangDay ? <span className="text-[9px]">…</span> : <PaperclipIcon className="size-3.5" />}
      </button>
    </span>
  );
}
