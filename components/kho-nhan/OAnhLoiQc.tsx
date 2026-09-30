'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { KhoiLoi } from './KhoiLoi';
import type { AnhLoiQc } from '@/features/kho-nhan/anh-loi-qc';

/**
 * Ô "Ảnh lỗi QC" trên từng dòng bảng Nhận hôm nay (CEO 30/09/2026).
 *
 * CEO chọn "hiện VÀ thêm được ngay tại bảng". Nút `+ thêm` mở ĐÚNG khối nhập lỗi của modal
 * kiểm chứ không làm một ô tải ảnh riêng — để ảnh luôn đi kèm LÝ DO LỖI. Ảnh không lý do là
 * bằng chứng không dùng được khi cãi với brand, và bảng `wh_loi_qc` sinh ra để giữ đúng cặp đó.
 *
 * Bảng này chỉ liệt kê chiếc CHƯA kiểm, nên ô thường trống: nó là chỗ ĐÍNH BẰNG CHỨNG lúc đánh
 * fail, không phải kho ảnh của hàng đã kiểm xong.
 */
export function OAnhLoiQc({ itemId, anh, coStorage, sauKhiLuu }: {
  itemId: string;
  anh: AnhLoiQc[];
  coStorage: boolean;
  sauKhiLuu: () => void;
}) {
  const [mo, setMo] = useState(false);

  return (
    <>
      {anh.length === 0 ? (
        <button
          type="button" onClick={() => setMo(true)}
          className="cursor-pointer rounded-md border border-dashed border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-input hover:text-foreground"
        >+ thêm</button>
      ) : (
        <button type="button" onClick={() => setMo(true)} className="flex cursor-pointer items-center gap-1">
          {anh.slice(0, 3).map((a) => (
            a.url ? (
              // eslint-disable-next-line @next/next/no-img-element -- ảnh S3 ký hạn ngắn, không qua optimiser (cùng cách OAnhNhan đang dùng)
              <img key={a.id} src={a.url} alt={a.nhanLyDo} title={a.nhanLyDo}
                   className="size-8 rounded border border-border object-cover" />
            ) : (
              // Ký hỏng vẫn phải hiện DẤU: mất ảnh khác hẳn không có lỗi nào.
              <span key={a.id} title={a.nhanLyDo}
                    className="grid size-8 place-items-center rounded border border-border text-[9px] text-muted-foreground">ảnh</span>
            )
          ))}
          {anh.length > 3 && <span className="text-xs text-muted-foreground">+{anh.length - 3}</span>}
        </button>
      )}

      <Dialog open={mo} onOpenChange={setMo}>
        <DialogContent className="sm:max-w-2xl">
          <DialogTitle className="text-base">Lỗi QC của chiếc này</DialogTitle>
          {anh.length > 0 && (
            <ul className="space-y-1 text-xs">
              {anh.map((a) => (
                <li key={a.id} className="flex items-center gap-2">
                  <b>{a.nhanLyDo}</b>
                  {a.ghiChu && <span className="text-muted-foreground">{a.ghiChu}</span>}
                  {a.url && <a href={a.url} target="_blank" rel="noreferrer" className="cursor-pointer underline">xem ảnh</a>}
                </li>
              ))}
            </ul>
          )}
          <KhoiLoi
            itemId={itemId} coStorage={coStorage}
            onXong={() => { setMo(false); sauKhiLuu(); }}
            onHuy={() => setMo(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
