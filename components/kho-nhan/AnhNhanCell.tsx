'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { themAnhNhan, xoaAnhNhan } from '@/features/kho-nhan/anh-nhan';
import { chapNhanKieu, tenFileDan } from '@/features/kho-nhan/dan-anh';
import type { AnhNhan, LoaiAnhNhan } from '@/features/kho-nhan/types';

export const TEN_LOAI: Record<LoaiAnhNhan, { ten: string; y: string }> = {
  hang_den: { ten: 'Ảnh hàng đến', y: 'Chụp thấy ĐỦ SỐ LƯỢNG lô hàng vừa nhận' },
  bb_ban_giao: { ten: 'Biên bản bàn giao', y: 'Biên bản brand đưa lúc giao hàng' },
};

const laAnh = (a: AnhNhan) => !/\.pdf$/i.test(a.tenFile ?? a.s3Key);

/**
 * Ô đính kèm trên TỪNG DÒNG, giống hình bảng Lark (CEO 25/09).
 *
 * Ảnh vẫn lưu ở mức PHIẾU — một tấm chụp cả lô — nhưng HIỆN trên mọi dòng của
 * lô đó, đúng như Lark hiện. Bấm vào mở modal, không bày sẵn khối tải file
 * chiếm nửa màn hình.
 */
export function OAnhNhan({ anh, onMo }: { anh: AnhNhan[]; onMo: () => void }) {
  if (anh.length === 0) {
    return (
      <button
        type="button" onClick={onMo}
        className="cursor-pointer rounded-md border border-dashed border-border px-2 py-1 text-xs text-muted-foreground hover:border-input hover:text-foreground"
      >+ thêm</button>
    );
  }
  return (
    <button type="button" onClick={onMo} className="flex cursor-pointer items-center gap-1">
      {anh.slice(0, 3).map((a) => (
        laAnh(a) && a.url ? (
          // eslint-disable-next-line @next/next/no-img-element -- ảnh S3 ký hạn ngắn, không qua optimiser của Next (cùng cách StagingBoard đang dùng)
          <img key={a.id} src={a.url} alt={a.tenFile ?? ''}
               className="size-8 rounded border border-border object-cover" />
        ) : (
          <span key={a.id} className="grid size-8 place-items-center rounded border border-border text-[10px] text-muted-foreground">
            PDF
          </span>
        )
      ))}
      {anh.length > 3 && <span className="text-xs text-muted-foreground">+{anh.length - 3}</span>}
    </button>
  );
}

export function ModalAnhNhan({
  mo, receiptId, vendor, loai, anh, coStorage, onDong, onXong,
}: {
  mo: boolean; receiptId: string; vendor: string | null; loai: LoaiAnhNhan;
  anh: AnhNhan[]; coStorage: boolean; onDong: () => void; onXong: () => void;
}) {
  const [dangTai, setDangTai] = useState(false);
  const vung = useRef<HTMLDivElement>(null);

  const tai = async (ds: File[]) => {
    if (ds.length === 0) return;
    setDangTai(true);
    try {
      let hong = 0;
      // Tuần tự: mười ảnh cùng lúc từ máy kho là nghẽn, người dùng chỉ thấy
      // "thất bại" mà không hiểu vì sao.
      for (const f of ds) {
        const fd = new FormData();
        fd.set('receiptId', receiptId); fd.set('loai', loai); fd.set('file', f);
        const r = await themAnhNhan(fd);
        if (!r.ok) { hong += 1; toast.error(`${f.name}: ${r.loi ?? 'lỗi'}`, { duration: 10000 }); }
      }
      if (ds.length - hong > 0) toast.success(`Đã tải ${ds.length - hong} file.`, { duration: 3000 });
      onXong();
    } catch (e) {
      console.error('[kho-nhan] tải ảnh nhận lỗi:', e);
      toast.error('Không gọi được máy chủ. Thử lại.', { duration: 10000 });
    } finally {
      setDangTai(false);
    }
  };

  /* Dán thẳng từ Zalo. Ảnh dán không mang tên gốc nên phải tự đặt — dán năm
   * tấm mà cùng tên "image.png" thì danh sách không phân biệt được. */
  const dan = (e: React.ClipboardEvent) => {
    const tho = Array.from(e.clipboardData?.items ?? [])
      .filter((i) => i.kind === 'file')
      .map((i) => i.getAsFile())
      .filter((f): f is File => f !== null && chapNhanKieu(f.type));
    if (tho.length === 0) return;
    e.preventDefault();
    const luc = new Date();
    void tai(tho.map((f, i) => new File([f], tenFileDan(loai, f.type, luc, i + 1), { type: f.type })));
  };

  const go = async (a: AnhNhan) => {
    const r = await xoaAnhNhan(a.id);
    if (!r.ok) { toast.error(r.loi ?? 'Gỡ ảnh thất bại.', { duration: 10000 }); return; }
    toast.success('Đã gỡ file.', { duration: 3000 });
    onXong();
  };

  return (
    <Dialog open={mo} onOpenChange={(v) => { if (!v) onDong(); }}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[680px]">
        <div className="shrink-0 border-b border-border px-5 py-3">
          <DialogTitle className="text-base font-semibold">{TEN_LOAI[loai].ten}</DialogTitle>
          <p className="text-xs text-muted-foreground">
            {vendor ?? 'Không rõ brand'} · {TEN_LOAI[loai].y}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {!coStorage ? (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              Chưa cấu hình kho lưu file — không tải được ảnh lên.
            </p>
          ) : (
            <>
              <div
                ref={vung}
                tabIndex={0}
                autoFocus
                onPaste={dan}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  const ds = Array.from(e.dataTransfer?.files ?? []).filter((f) => chapNhanKieu(f.type));
                  if (ds.length === 0) return;
                  e.preventDefault(); void tai(ds);
                }}
                onClick={() => vung.current?.focus()}
                className="cursor-pointer rounded-lg border border-dashed border-border p-6 text-center focus:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
              >
                <p className="text-sm">
                  Dán ảnh bằng <kbd className="rounded border border-border px-1">Ctrl/Cmd+V</kbd> — hoặc kéo thả file vào đây
                </p>
                <p className="mt-1 text-xs text-muted-foreground">copy thẳng từ Zalo là dán được</p>
                <label className="mt-3 inline-block">
                  <span className="sr-only">Chọn file</span>
                  <input
                    type="file" multiple accept="image/*,.pdf" disabled={dangTai}
                    onChange={(e) => {
                      const f = e.target.files;
                      if (f && f.length) void tai(Array.from(f));
                      e.target.value = '';
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="block cursor-pointer text-xs file:mr-2 file:cursor-pointer file:rounded-md file:border file:border-input file:bg-background file:px-2 file:py-1 file:text-xs"
                  />
                </label>
              </div>
              {dangTai && <p className="mt-2 text-sm text-muted-foreground">Đang tải…</p>}
            </>
          )}

          {anh.length > 0 && (
            <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4">
              {anh.map((a) => (
                <div key={a.id} className="space-y-1">
                  <a href={a.url ?? '#'} target="_blank" rel="noreferrer" className="block">
                    {laAnh(a) && a.url ? (
                      // eslint-disable-next-line @next/next/no-img-element -- ảnh S3 ký hạn ngắn, không qua optimiser của Next
                      <img src={a.url} alt={a.tenFile ?? ''}
                           className="aspect-square w-full rounded-lg border border-border object-cover" />
                    ) : (
                      <span className="grid aspect-square w-full place-items-center rounded-lg border border-border text-xs text-muted-foreground">
                        PDF
                      </span>
                    )}
                  </a>
                  <button
                    type="button" onClick={() => void go(a)}
                    className="cursor-pointer text-xs text-muted-foreground hover:text-destructive"
                  >gỡ</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
