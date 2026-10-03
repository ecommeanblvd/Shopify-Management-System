'use client';

import { useEffect, useRef, useState } from 'react';
import { datTenAnhDan } from './ten-anh-dan';

/**
 * Bọc một `<input type="file">` để nhận ảnh bằng DÁN (Ctrl/Cmd+V) và KÉO THẢ (CEO 01/10/2026:
 * "các ô upload ảnh đều cho phép copy ảnh từ 1 nơi khác — ví dụ Zalo, tin nhắn — rồi paste").
 *
 * Dán được mà KHÔNG CẦN bấm vào ô (03/10/2026). Bản đầu chỉ nghe `onPaste` của chính khung, mà
 * khung phải có focus mới nhận — trong khi thứ nằm giữa khung là `<input type="file">`, bấm vào
 * là mở hộp thoại chọn file của máy. Đội đóng hàng bấm đúng nút đó, thấy máy đòi file, rồi kết
 * luận "phải lưu ảnh về máy" và quay sang dán thẳng vào Lark — đó là lý do 429/463 dòng QC
 * Failed trên Lark có ảnh do người dán tay, chứ không phải do hệ thống đẩy lên.
 *
 * GIỮ NGUYÊN input thật bên trong và chỉ gán `files` vào nó, nên đường gửi form không đổi một
 * dòng nào: vẫn là `name` đó, vẫn `required` đó, máy chủ đọc y như cũ. Dựng một đường tải ảnh
 * riêng cạnh đường form đang chạy là đúng loại lỗi "hai nguồn cho một việc" đã sửa cả ngày.
 *
 * Ảnh dán từ Zalo vào clipboard không có tên tệp — `datTenAnhDan` đặt tên theo thời điểm để
 * máy chủ và người đọc về sau còn phân biệt được, thay vì một loạt "image.png" chồng nhau.
 *
 * `onChon`: dùng cho ô tải ảnh NGAY khi chọn (không qua submit form) — ví dụ khối lỗi QC, nơi
 * mỗi ảnh được đẩy lên storage liền rồi giữ lại `anhKey`. Không truyền thì ô chạy như một
 * trường form thường. MỘT component cho cả hai kiểu: dựng component thứ hai chỉ để có chỗ dán
 * là đúng loại lỗi "hai nguồn cho một việc".
 */
/** Một ô đã gắn vào trang, theo thứ tự xuất hiện trên màn hình. */
export interface ONhanAnhDaGan {
  /** Thứ tự trên màn hình — nhỏ hơn là nằm trước. */
  thuTu: number;
  /** Ô này đã có ảnh chưa. */
  coFile: boolean;
  disabled: boolean;
}

/**
 * THUẦN: dán ảnh khi KHÔNG bấm vào ô nào thì ảnh vào ô nào. Trả chỉ số, hoặc `null` = không ô
 * nào nhận.
 *
 * Ô TRỐNG ĐẦU TIÊN, và **không bao giờ ghi đè ô đã có ảnh**. Khối lỗi QC bày nhiều ô cùng lúc
 * (mỗi chỗ lỗi một ô); đè lên tấm vừa dán là làm mất bằng chứng mà không ai thấy. Muốn thay
 * tấm cũ thì bấm vào đúng ô đó rồi dán — đường đó vẫn chạy như trước.
 */
export function chonOTrong(ds: readonly ONhanAnhDaGan[]): number | null {
  let chon: { i: number; thuTu: number } | null = null;
  ds.forEach((o, i) => {
    if (o.disabled || o.coFile) return;
    if (chon === null || o.thuTu < chon.thuTu) chon = { i, thuTu: o.thuTu };
  });
  return chon === null ? null : (chon as { i: number }).i;
}

/* Sổ các ô đang hiện trên màn hình, để lượt dán KHÔNG CẦN focus tìm được đúng ô.
 *
 * Vì sao cần: `onPaste` của React chỉ bắn khi ô đang có focus, mà thứ nằm giữa ô là một
 * `<input type="file">` — bấm vào nó là MỞ HỘP THOẠI CHỌN FILE của máy. Đội kho bấm đúng nút
 * đó, thấy máy đòi file, rồi kết luận "phải lưu ảnh về máy mới upload được" và quay sang dán
 * thẳng vào Lark (CEO 03/10/2026). Nghe ở cấp tài liệu thì copy từ Zalo xong bấm Ctrl/Cmd+V ở
 * đâu cũng được. */
export interface OTrongSo {
  el: HTMLElement | null;
  coFile: () => boolean;
  disabled: boolean;
  dat: (fs: File[]) => void;
}
const SO: OTrongSo[] = [];
let daGanNghe = false;

/**
 * Xử lý một lượt dán ở cấp tài liệu. Tách ra (và nhận `so` từ ngoài) để test được mà không cần
 * dựng cả một trình duyệt: mọi quyết định bỏ-qua ở đây đều là chỗ dễ sai âm thầm.
 */
export function xuLyDan(e: {
  defaultPrevented: boolean;
  clipboardData: { files: ArrayLike<File> } | null;
  preventDefault: () => void;
}, so: readonly OTrongSo[]): void {
  // Ô có focus đã tự xử lý (nó gọi `preventDefault`) — không làm lần hai.
  if (e.defaultPrevented) return;
  const anh = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
  // Dán CHỮ (vào ô ghi chú chẳng hạn) không có file — không đụng tới.
  if (anh.length === 0) return;
  const hien = so.filter((o) => o.el?.isConnected);
  if (hien.length === 0) return;
  // Thứ tự TRÊN MÀN HÌNH, không phải thứ tự gắn vào sổ: ô thêm sau có thể nằm trên.
  const sapXep = [...hien].sort((a, b) =>
    // 4 = Node.DOCUMENT_POSITION_FOLLOWING — viết thẳng số để hàm chạy được ngoài trình duyệt.
    a.el!.compareDocumentPosition(b.el!) & 4 ? -1 : 1);
  const i = chonOTrong(sapXep.map((o, k) => ({ thuTu: k, coFile: o.coFile(), disabled: o.disabled })));
  if (i === null) return;
  e.preventDefault();
  sapXep[i]!.dat(anh);
}

function nghePaste(e: ClipboardEvent): void {
  xuLyDan(e, SO);
}

export function ONhanAnh({ name, required, disabled, className, goiY, onChon }: {
  name: string; required?: boolean; disabled?: boolean; className?: string; goiY?: string;
  onChon?: (f: File) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const khung = useRef<HTMLDivElement>(null);
  const [ten, setTen] = useState<string | null>(null);
  const [keo, setKeo] = useState(false);
  // Đọc trạng thái mới nhất trong listener mà không phải gắn lại listener mỗi lần đổi.
  // Gán trong effect chứ không trong thân render — đụng `ref.current` lúc render là lỗi React.
  const coFile = useRef(false);
  useEffect(() => { coFile.current = ten !== null; }, [ten]);

  const dat = (fs: File[]) => {
    const anh = fs.filter((f) => f.type.startsWith('image/'));
    if (anh.length === 0 || !ref.current) return;
    const dt = new DataTransfer();
    dt.items.add(datTenAnhDan(anh[0]!));
    ref.current.files = dt.files;
    const f = dt.files[0] ?? null;
    setTen(f?.name ?? null);
    if (f) onChon?.(f);
  };

  useEffect(() => {
    const muc = { el: khung.current, coFile: () => coFile.current, disabled: !!disabled, dat };
    SO.push(muc);
    if (!daGanNghe) { document.addEventListener('paste', nghePaste); daGanNghe = true; }
    return () => {
      const i = SO.indexOf(muc);
      if (i >= 0) SO.splice(i, 1);
      // Gỡ listener khi không còn ô nào — để trang khác không mang theo một người nghe thừa.
      if (SO.length === 0 && daGanNghe) { document.removeEventListener('paste', nghePaste); daGanNghe = false; }
    };
    // `dat` dựng lại mỗi lượt render nhưng chỉ đọc `ref`, nên không cần gắn lại.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);

  return (
    <div
      ref={khung}
      onPaste={(e) => {
        if (disabled) return;
        const fs = Array.from(e.clipboardData?.files ?? []);
        if (fs.length === 0) return;
        e.preventDefault(); dat(fs);
      }}
      onDragOver={(e) => { if (!disabled) { e.preventDefault(); setKeo(true); } }}
      onDragLeave={() => setKeo(false)}
      onDrop={(e) => {
        if (disabled) return;
        setKeo(false);
        const fs = Array.from(e.dataTransfer?.files ?? []);
        if (fs.length === 0) return;
        e.preventDefault(); dat(fs);
      }}
      tabIndex={disabled ? -1 : 0}
      className={`rounded-md border border-dashed p-1.5 outline-none focus-visible:border-ring
        ${keo ? 'border-primary bg-primary/5' : 'border-border'} ${disabled ? 'opacity-60' : ''}`}
    >
      <input ref={ref} name={name} type="file" accept="image/*" required={required} disabled={disabled}
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          setTen(f?.name ?? null);
          if (f) onChon?.(f);
        }} className={className} />
      <p className="mt-1 text-[10px] leading-tight text-muted-foreground">
        {ten ? `đã chọn: ${ten}` : (goiY ?? 'Copy ảnh từ Zalo rồi Ctrl/Cmd+V — không cần bấm vào đâu. Hoặc kéo thả, hoặc bấm chọn file.')}
      </p>
    </div>
  );
}
